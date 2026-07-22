import { createHash } from 'node:crypto';
import { decryptAuthenticatedJson, encryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import { db } from './client';

export const ARCHIVE_IDEMPOTENCY_COLLECTION = 'archiveIdempotency';
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_COMPLETED_TTL_MS = 24 * 60 * 60_000;

export interface ArchiveIdempotencyIdentity {
  organizationKey: string;
  actorKey: string;
  tool: string;
  idempotencyKey: string;
}

export type ArchiveIdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'pending' }
  | { status: 'conflict' }
  | { status: 'replay'; response: unknown };

function ledgerKey(identity: ArchiveIdempotencyIdentity): string {
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

export function encryptArchiveReplayResponse(response: unknown): string {
  return encryptAuthenticatedJson(response);
}

export function decryptArchiveReplayResponse(ciphertext: string): unknown {
  try {
    return decryptAuthenticatedJson(ciphertext);
  } catch {
    throw new Error('Unable to decrypt Archive idempotency response');
  }
}

export async function claimArchiveIdempotency(
  identity: ArchiveIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  now: string,
): Promise<ArchiveIdempotencyClaim> {
  const key = ledgerKey(identity);
  const leaseExpiresAt = future(now, Number(process.env.ARCHIVE_IDEMPOTENCY_LEASE_MS ?? DEFAULT_LEASE_MS));
  const cursor = await db.query<Record<string, unknown>>(`
    LET existing = DOCUMENT(archiveIdempotency, @key)
    FILTER existing == null || existing.expiresAt <= @now
      || (existing.status == "pending" && (!HAS(existing, "leaseExpiresAt") || existing.leaseExpiresAt <= @now))
    UPSERT { _key: @key }
      INSERT MERGE(@identity, { _key: @key, requestHash: @requestHash, status: "pending", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, createdAt: @now, updatedAt: @now })
      UPDATE MERGE(@identity, { requestHash: @requestHash, status: "pending", leaseOwner: @leaseOwner, leaseExpiresAt: @leaseExpiresAt, responseCiphertext: null, expiresAt: null, updatedAt: @now })
      IN archiveIdempotency OPTIONS { keepNull: false }
    RETURN NEW
  `, { key, identity, requestHash, leaseOwner, leaseExpiresAt, now });
  if (await cursor.next()) return { status: 'claimed' };

  const existing = await db.collection(ARCHIVE_IDEMPOTENCY_COLLECTION).document(key) as Record<string, unknown>;
  if (existing.requestHash !== requestHash) return { status: 'conflict' };
  if (existing.status === 'completed') {
    if (typeof existing.responseCiphertext !== 'string') throw new Error('Archive idempotency response is missing ciphertext.');
    return { status: 'replay', response: decryptArchiveReplayResponse(existing.responseCiphertext) };
  }
  return { status: 'pending' };
}

export async function completeArchiveIdempotency(
  identity: ArchiveIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
  response: unknown,
  now: string,
): Promise<void> {
  const responseCiphertext = encryptArchiveReplayResponse(response);
  const expiresAt = future(now, Number(process.env.ARCHIVE_IDEMPOTENCY_COMPLETED_TTL_MS ?? DEFAULT_COMPLETED_TTL_MS));
  const cursor = await db.query(`
    FOR claim IN archiveIdempotency
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "pending" && claim.leaseOwner == @leaseOwner
      UPDATE claim WITH { status: "completed", responseCiphertext: @responseCiphertext, expiresAt: @expiresAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: @now }
        IN archiveIdempotency OPTIONS { keepNull: false }
      RETURN NEW
  `, { key: ledgerKey(identity), requestHash, leaseOwner, responseCiphertext, expiresAt, now });
  if (!await cursor.next()) throw new Error('Archive idempotency claim could not be completed.');
}

export async function releaseArchiveIdempotency(
  identity: ArchiveIdempotencyIdentity,
  requestHash: string,
  leaseOwner: string,
): Promise<void> {
  await db.query(`
    FOR claim IN archiveIdempotency
      FILTER claim._key == @key && claim.requestHash == @requestHash
        && claim.status == "pending" && claim.leaseOwner == @leaseOwner
      REMOVE claim IN archiveIdempotency
  `, { key: ledgerKey(identity), requestHash, leaseOwner });
}
