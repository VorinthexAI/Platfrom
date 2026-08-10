import { createHash } from 'node:crypto';
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

export type ContentIdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'pending' }
  | { status: 'conflict' }
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

export async function claimContentIdempotency(
  identity: ContentIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  now: string,
): Promise<ContentIdempotencyClaim> {
  const key = ledgerKey(identity);
  const collection = await resolveContentLedgerCollection(db, CONTENT_IDEMPOTENCY_COLLECTION);
  const leaseExpiresAt = future(now, Number(process.env.CONTENT_IDEMPOTENCY_LEASE_MS ?? DEFAULT_LEASE_MS));
  const cursor = await db.query<Record<string, unknown>>(`
    LET existing = DOCUMENT(@@collection, @key)
    FILTER existing == null
      || (existing.status == "completed" && existing.expiresAt <= @now)
      || (existing.status == "pending" && existing.requestHash == @requestHash && existing.leaseExpiresAt <= @now)
    UPSERT { _key: @key }
      INSERT MERGE(@identity, { _key: @key, requestHash: @requestHash, status: "pending", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, createdAt: @now, updatedAt: @now })
      UPDATE MERGE(@identity, { requestHash: @requestHash, status: "pending", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, responseCiphertext: null, expiresAt: null, updatedAt: @now })
      IN @@collection OPTIONS { keepNull: false }
    RETURN NEW
  `, { '@collection': collection, key, identity, requestHash, leaseOwner, leaseExpiresAt, now });
  if (await cursor.next()) return { status: 'claimed' };

  const existing = await db.collection(collection).document(key) as Record<string, unknown>;
  if (existing.requestHash !== requestHash) return { status: 'conflict' };
  if (existing.status === 'completed') {
    if (typeof existing.responseCiphertext !== 'string') throw new Error('Content idempotency response is missing ciphertext.');
    return { status: 'replay', response: decryptContentReplayResponse(existing.responseCiphertext) };
  }
  return { status: 'pending' };
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
        && claim.status == "pending" && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { status: "completed", responseCiphertext: @responseCiphertext, expiresAt: @expiresAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: @now }
        IN @@collection OPTIONS { keepNull: false }
      RETURN NEW
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner, responseCiphertext, expiresAt, now });
  if (!await cursor.next()) throw new Error('Content idempotency claim could not be completed.');
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
        && claim.status == "pending" && claim.leaseOwner == @leaseOwner
      REMOVE claim IN @@collection
  `, { '@collection': collection, key: ledgerKey(identity), requestHash, leaseOwner });
}
