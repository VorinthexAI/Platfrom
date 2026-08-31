import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decryptAuthenticatedJson, encryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import { db } from './client';
import { resolveContentLedgerCollection } from './legacy-contracts';

export const CONTENT_IDEMPOTENCY_COLLECTION = 'contentIdempotency';
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_COMPLETED_TTL_MS = 24 * 60 * 60_000;

export interface ContentIdempotencyIdentity {
  organizationKey: string;
  actorKey: string;
  tool: string;
  idempotencyKey: string;
}

export const contentIdempotencyFailureSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
}).strict();
export type ContentIdempotencyFailure = z.infer<typeof contentIdempotencyFailureSchema>;

export type ContentIdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'pending' }
  | { status: 'indeterminate' }
  | { status: 'conflict' }
  | { status: 'failed'; failure: ContentIdempotencyFailure }
  | { status: 'replay'; response: unknown };

function ledgerKey(identity: ContentIdempotencyIdentity): string {
  return `c${createHash('sha256')
    .update(identity.organizationKey).update('\0')
    .update(identity.actorKey).update('\0')
    .update(identity.tool).update('\0')
    .update(identity.idempotencyKey)
    .digest('hex').slice(0, 24)}`;
}

function future(now: string, milliseconds: number): string {
  return new Date(new Date(now).getTime() + milliseconds).toISOString();
}

export function encryptContentReplayResponse(response: unknown): string {
  return encryptAuthenticatedJson(response);
}

export function decryptContentReplayResponse(ciphertext: string): unknown {
  try {
    return decryptAuthenticatedJson(ciphertext);
  } catch {
    throw new Error('Unable to decrypt Content idempotency response');
  }
}

export function encryptContentIdempotencyFailure(failure: ContentIdempotencyFailure): string {
  return encryptAuthenticatedJson(contentIdempotencyFailureSchema.parse(failure));
}

export function decryptContentIdempotencyFailure(ciphertext: string): ContentIdempotencyFailure {
  try {
    return contentIdempotencyFailureSchema.parse(decryptAuthenticatedJson(ciphertext));
  } catch {
    throw new Error('Unable to decrypt Content idempotency failure');
  }
}

export function classifyContentIdempotencyRecord(existing: Record<string, unknown>, requestHash: string, now: string): ContentIdempotencyClaim {
  if (existing.requestHash !== requestHash) return { status: 'conflict' };
  if (existing.status === 'completed') {
    if (typeof existing.responseCiphertext !== 'string') throw new Error('Content idempotency response is missing ciphertext.');
    return { status: 'replay', response: decryptContentReplayResponse(existing.responseCiphertext) };
  }
  if (existing.status === 'failed') {
    if (typeof existing.failureCiphertext !== 'string') throw new Error('Content idempotency failure is missing ciphertext.');
    return { status: 'failed', failure: decryptContentIdempotencyFailure(existing.failureCiphertext) };
  }
  const active = typeof existing.leaseExpiresAt === 'string' && existing.leaseExpiresAt > now;
  const started = existing.status === 'started' || existing.status === 'claimed' && typeof existing.executionStartedAt === 'string';
  if (started) return active ? { status: 'pending' } : { status: 'indeterminate' };
  if (existing.status === 'claimed') return active ? { status: 'pending' } : { status: 'indeterminate' };
  // Legacy pending and unknown rows may already have effects and are never safe to execute again.
  return { status: 'indeterminate' };
}

export async function claimContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  now: string,
  retryFailed = false,
): Promise<ContentIdempotencyClaim> {
  const key = ledgerKey(identity);
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const leaseExpiresAt = future(now, Number(process.env.CONTENT_IDEMPOTENCY_LEASE_MS ?? DEFAULT_LEASE_MS));
  const cursor = await db.query<Record<string, unknown>>(`
    LET existing = DOCUMENT(@@collection, @key)
    FILTER existing == null
      || (existing.status == "claimed" && existing.requestHash == @requestHash && existing.leaseExpiresAt <= @now && existing.executionStartedAt == null)
      || (@retryFailed && existing.status == "failed" && existing.requestHash == @requestHash && existing.failureRetryable == true)
    UPSERT { _key: @key }
      INSERT MERGE(@identity, { _key: @key, requestHash: @requestHash, status: "claimed", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, createdAt: @now, updatedAt: @now })
      UPDATE MERGE(@identity, { requestHash: @requestHash, status: "claimed", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, executionStartedAt: null, responseCiphertext: null, failureCiphertext: null, failureRetryable: null, expiresAt: null, updatedAt: @now })
      IN @@collection OPTIONS { keepNull: false }
    RETURN NEW
  `, { '@collection': collection, key, identity, requestHash, leaseOwner, leaseExpiresAt, now, retryFailed });
  if (await cursor.next()) return { status: 'claimed' };

  const existing = await db.collection(collection).document(key) as Record<string, unknown>;
  return classifyContentIdempotencyRecord(existing, requestHash, now);
}

export async function startContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  now: string,
): Promise<boolean> {
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const cursor = await db.query(`
    FOR claim IN @@collection
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "claimed" && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { status: "started", executionStartedAt: @now, updatedAt: @now } IN @@collection
      RETURN true
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner, now });
  return Boolean(await cursor.next());
}

export async function completeContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  response: unknown,
  now: string,
): Promise<void> {
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const responseCiphertext = encryptContentReplayResponse(response);
  const expiresAt = future(now, Number(process.env.CONTENT_IDEMPOTENCY_COMPLETED_TTL_MS ?? DEFAULT_COMPLETED_TTL_MS));
  const cursor = await db.query(`
    FOR claim IN @@collection
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "started" && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { status: "completed", responseCiphertext: @responseCiphertext, expiresAt: @expiresAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: @now }
        IN @@collection OPTIONS { keepNull: false }
      RETURN NEW
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner, responseCiphertext, expiresAt, now });
  if (!await cursor.next()) throw new Error('Content idempotency claim could not be completed.');
}

export async function failContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  failure: ContentIdempotencyFailure,
  now: string,
): Promise<void> {
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const failureCiphertext = encryptContentIdempotencyFailure(failure);
  const cursor = await db.query(`
    FOR claim IN @@collection
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "started" && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { status: "failed", failureCiphertext: @failureCiphertext, failureRetryable: @failureRetryable, responseCiphertext: null, leaseOwner: null, leaseExpiresAt: null, expiresAt: null, updatedAt: @now }
        IN @@collection OPTIONS { keepNull: false }
      RETURN NEW
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner, failureCiphertext, failureRetryable: failure.retryable, now });
  if (!await cursor.next()) throw new Error('Content idempotency claim could not be failed.');
}

export async function renewContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  now: string,
): Promise<boolean> {
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const leaseExpiresAt = future(now, Number(process.env.CONTENT_IDEMPOTENCY_LEASE_MS ?? DEFAULT_LEASE_MS));
  const cursor = await db.query(`
    FOR claim IN @@collection
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status IN ["claimed", "started"] && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { leaseExpiresAt: @leaseExpiresAt, updatedAt: @now } IN @@collection
      RETURN true
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner, leaseExpiresAt, now });
  return Boolean(await cursor.next());
}

export async function releaseContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
): Promise<void> {
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  await db.query(`
    FOR claim IN @@collection
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "claimed" && claim.leaseOwner == @leaseOwner
      REMOVE claim IN @@collection
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner });
}
