import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { acknowledgeStorageDeletionJob, listStorageDeletionJobs, type StorageDeletionJob } from '@/lib/db/storage-deletion-jobs.node';

type StorageDeletionDependencies = {
  list?: (limit: number) => Promise<StorageDeletionJob[]>;
  acknowledge?: (key: string, storageKey: string) => Promise<boolean>;
  storage?: Pick<DocumentStorage, 'delete'>;
};

export async function drainStorageDeletionJobs(limit = 100, dependencies: StorageDeletionDependencies = {}): Promise<{ deleted: number; pending: number }> {
  const jobs = await (dependencies.list ?? listStorageDeletionJobs)(limit);
  let deleted = 0;
  let pending = 0;
  for (const job of jobs) {
    try {
      await (dependencies.storage ?? documentStorage).delete(job.storageKey);
      await (dependencies.acknowledge ?? acknowledgeStorageDeletionJob)(job.key, job.storageKey);
      deleted += 1;
    } catch {
      pending += 1;
    }
  }
  return { deleted, pending };
}
