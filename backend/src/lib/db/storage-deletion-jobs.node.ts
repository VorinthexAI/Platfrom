import { z } from 'zod';
import { db } from './client';
import { withArangoKey } from './base';

export const STORAGE_DELETION_JOBS_COLLECTION = 'storageDeletionJobs';
export const storageDeletionJobSchema = z.object({
  key: z.string().min(1),
  storageKey: z.string().trim().min(1),
  createdAt: z.string().datetime(),
}).strict();

export type StorageDeletionJob = z.infer<typeof storageDeletionJobSchema>;

export async function listStorageDeletionJobs(limit = 100): Promise<StorageDeletionJob[]> {
  const cursor = await db.query('FOR job IN storageDeletionJobs SORT job.createdAt ASC, job._key ASC LIMIT @limit RETURN job', { limit: z.number().int().min(1).max(1000).parse(limit) });
  return (await cursor.all()).map((job) => storageDeletionJobSchema.parse(withArangoKey(job)));
}

export async function acknowledgeStorageDeletionJob(key: string, storageKey: string): Promise<boolean> {
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job._key == @key && job.storageKey == @storageKey REMOVE job IN storageDeletionJobs RETURN true', { key, storageKey });
  return await cursor.next() === true;
}

export async function acknowledgeStorageDeletionKey(storageKey: string): Promise<boolean> {
  const cursor = await db.query('FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey REMOVE job IN storageDeletionJobs RETURN true', { storageKey });
  return await cursor.next() === true;
}
