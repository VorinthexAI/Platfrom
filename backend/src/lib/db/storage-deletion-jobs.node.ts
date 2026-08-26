import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from './client';
import { withArangoKey } from './base';

export const STORAGE_DELETION_JOBS_COLLECTION = 'storageDeletionJobs';
export const STORAGE_UPLOAD_RESERVATION_MS = 15 * 60_000;
export const STORAGE_UPLOAD_HEARTBEAT_MS = 60_000;
export const STORAGE_DELETION_CLAIM_MS = 30 * 60_000;
export const STORAGE_DELETION_HEARTBEAT_MS = 60_000;
export const storageDeletionJobSchema = z.object({
  key: z.string().min(1),
  storageKey: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  status: z.enum(['pending', 'reserved', 'deleting']).default('pending'),
  reservationExpiresAt: z.string().datetime().optional(),
  claimToken: z.string().uuid().optional(),
  claimedAt: z.string().datetime().optional(),
}).strict();

export type StorageDeletionJob = z.infer<typeof storageDeletionJobSchema>;
export type StorageUploadReservation = { storageKey: string; token: string };

export async function listStorageDeletionJobs(limit = 100): Promise<StorageDeletionJob[]> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STORAGE_DELETION_CLAIM_MS).toISOString();
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job.status == null || job.status == "pending" || (job.status == "reserved" && job.reservationExpiresAt <= @now) || (job.status == "deleting" && job.claimedAt <= @staleBefore) SORT job.createdAt ASC, job._key ASC LIMIT @limit RETURN job', { limit: z.number().int().min(1).max(1000).parse(limit), now, staleBefore });
  return (await cursor.all()).map((job) => storageDeletionJobSchema.parse(withArangoKey(job)));
}

export async function claimStorageDeletionJobs(limit = 100): Promise<StorageDeletionJob[]> {
  const claimToken = randomUUID();
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STORAGE_DELETION_CLAIM_MS).toISOString();
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job.status == null || job.status == "pending" || (job.status == "reserved" && job.reservationExpiresAt <= @claimedAt) || (job.status == "deleting" && job.claimedAt <= @staleBefore) SORT job.createdAt ASC, job._key ASC LIMIT @limit UPDATE job WITH { status: "deleting", claimToken: @claimToken, claimedAt: @claimedAt, reservationExpiresAt: null } IN storageDeletionJobs OPTIONS { keepNull: false } RETURN NEW', { limit: z.number().int().min(1).max(1000).parse(limit), claimToken, claimedAt, staleBefore });
  return (await cursor.all()).map((job) => storageDeletionJobSchema.parse(withArangoKey(job)));
}

export async function acknowledgeStorageDeletionJob(key: string, storageKey: string, claimToken: string): Promise<boolean> {
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey && job.status == "deleting" && job.claimToken == @claimToken REMOVE job IN storageDeletionJobs RETURN true', { key, storageKey, claimToken });
  return await cursor.next() === true;
}

export async function releaseStorageDeletionJob(key: string, storageKey: string, claimToken: string): Promise<boolean> {
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey && job.status == "deleting" && job.claimToken == @claimToken UPDATE job WITH { status: "pending", claimToken: null, claimedAt: null } IN storageDeletionJobs OPTIONS { keepNull: false } RETURN true', { key, storageKey, claimToken });
  return await cursor.next() === true;
}

export async function renewStorageDeletionClaim(key: string, storageKey: string, claimToken: string): Promise<boolean> {
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey && job.status == "deleting" && job.claimToken == @claimToken UPDATE job WITH { claimedAt: @claimedAt } IN storageDeletionJobs RETURN true', { key, storageKey, claimToken, claimedAt: new Date().toISOString() });
  return await cursor.next() === true;
}

const storageReferenceAql = `
  LENGTH(FOR book IN books FILTER book.coverStorageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR chapter IN bookChapters FILTER chapter.audioStorageKey == @storageKey || chapter.imageStorageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR document IN documents FILTER document.storageKey == @storageKey || (IS_ARRAY(document.sourceStorageKeys) && @storageKey IN document.sourceStorageKeys) || (IS_ARRAY(document.speechStorageKeys) && @storageKey IN document.speechStorageKeys) LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR version IN documentVersions FILTER version.storageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR audio IN documentAudioVersions FILTER audio.storageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR audio IN documentSummaryAudio FILTER audio.storageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR image IN images FILTER image.storageKey == @storageKey LIMIT 1 RETURN 1) > 0 ||
  LENGTH(FOR upload IN galleryUploads FILTER upload.storageKey == @storageKey LIMIT 1 RETURN 1) > 0`;

/** Creates an owned durable upload lease without stealing another live owner. */
export async function reserveStorageKeyForUpload(storageKey: string): Promise<StorageUploadReservation | null> {
  const normalized = z.string().trim().min(1).parse(storageKey);
  const token = randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STORAGE_DELETION_CLAIM_MS).toISOString();
  const reservationExpiresAt = new Date(Date.now() + STORAGE_UPLOAD_RESERVATION_MS).toISOString();
  const cursor = await db.query('LET existing = FIRST(FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey LIMIT 1 RETURN job) FILTER existing == null || (existing.status == "reserved" && existing.reservationExpiresAt <= @now) || (existing.status == "deleting" && existing.claimedAt <= @staleBefore) UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now, status: "reserved", reservationExpiresAt: @reservationExpiresAt, claimToken: @token } UPDATE { status: "reserved", reservationExpiresAt: @reservationExpiresAt, claimToken: @token, claimedAt: null } IN storageDeletionJobs OPTIONS { keepNull: false } RETURN true', { storageKey: normalized, token, now, staleBefore, reservationExpiresAt });
  return await cursor.next() === true ? { storageKey: normalized, token } : null;
}

export async function renewStorageUploadReservation(reservation: StorageUploadReservation): Promise<boolean> {
  const reservationExpiresAt = new Date(Date.now() + STORAGE_UPLOAD_RESERVATION_MS).toISOString();
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey && job.status == "reserved" && job.claimToken == @token UPDATE job WITH { reservationExpiresAt: @reservationExpiresAt } IN storageDeletionJobs RETURN true', { ...reservation, reservationExpiresAt });
  return await cursor.next() === true;
}

/** Acknowledges only this reservation after its metadata reference is visible. */
export async function acknowledgeStorageUploadReservation(reservation: StorageUploadReservation): Promise<boolean> {
  const cursor = await db.query(`FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey && job.status == "reserved" && job.claimToken == @token LET referenced = ${storageReferenceAql} FILTER referenced REMOVE job IN storageDeletionJobs RETURN true`, reservation);
  return await cursor.next() === true;
}

/** Releases only this reservation after compensation removed the unreferenced object. */
export async function releaseStorageUploadReservation(reservation: StorageUploadReservation): Promise<boolean> {
  const cursor = await db.query(`FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey && job.status == "reserved" && job.claimToken == @token LET referenced = ${storageReferenceAql} FILTER !referenced REMOVE job IN storageDeletionJobs RETURN true`, reservation);
  return await cursor.next() === true;
}

/** Acknowledges a legacy deletion outbox row after direct object cleanup. */
export async function acknowledgeStorageDeletionKey(storageKey: string): Promise<boolean> {
  const cursor = await db.query(`FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey && job.status == "reserved" LET referenced = ${storageReferenceAql} FILTER referenced REMOVE job IN storageDeletionJobs RETURN true`, { storageKey });
  return await cursor.next() === true;
}

/** Atomically fences the final reference decision and renews an unreferenced claim. */
export async function resolveStorageDeletionClaim(key: string, storageKey: string, claimToken: string): Promise<'referenced' | 'unreferenced' | 'lost'> {
  const bindVars = { key, storageKey, claimToken, decidedAt: new Date().toISOString() };
  const acknowledged = await db.query(`FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey && job.status == "deleting" && job.claimToken == @claimToken LET referenced = ${storageReferenceAql} FILTER referenced REMOVE job IN storageDeletionJobs RETURN true`, bindVars);
  if (await acknowledged.next() === true) return 'referenced';
  const renewed = await db.query(`FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey && job.status == "deleting" && job.claimToken == @claimToken LET referenced = ${storageReferenceAql} FILTER !referenced UPDATE job WITH { claimedAt: @decidedAt } IN storageDeletionJobs RETURN true`, bindVars);
  return await renewed.next() === true ? 'unreferenced' : 'lost';
}

export async function isStorageKeyReferenced(storageKey: string): Promise<boolean> {
  const cursor = await db.query(`RETURN ${storageReferenceAql}`, { storageKey });
  return await cursor.next() === true;
}
