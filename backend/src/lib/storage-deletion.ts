import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { STORAGE_DELETION_HEARTBEAT_MS, acknowledgeStorageDeletionJob, claimStorageDeletionJobs, releaseStorageDeletionJob, renewStorageDeletionClaim, resolveStorageDeletionClaim, type StorageDeletionJob } from '@/lib/db/storage-deletion-jobs.node';

type StorageDeletionDependencies = {
  list?: (limit: number) => Promise<StorageDeletionJob[]>;
  acknowledge?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  release?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  referenced?: (storageKey: string) => Promise<boolean>;
  resolveClaim?: (key: string, storageKey: string, claimToken: string) => Promise<'referenced' | 'unreferenced' | 'lost'>;
  renew?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  heartbeatMs?: number;
  storage?: Pick<DocumentStorage, 'delete'>;
};

export async function drainStorageDeletionJobs(limit = 100, dependencies: StorageDeletionDependencies = {}): Promise<{ deleted: number; pending: number }> {
  const jobs = await (dependencies.list ?? claimStorageDeletionJobs)(limit);
  let deleted = 0;
  let pending = 0;
  for (const job of jobs) {
    try {
      if (!job.claimToken) throw new Error('Storage deletion job was not atomically claimed');
      const decision = dependencies.referenced
        ? await dependencies.referenced(job.storageKey) ? 'referenced' : 'unreferenced'
        : await (dependencies.resolveClaim ?? resolveStorageDeletionClaim)(job.key, job.storageKey, job.claimToken);
      if (decision === 'lost') throw new Error('Storage deletion claim fence was lost before reference verification');
      if (decision === 'referenced') {
        if (dependencies.referenced) await (dependencies.acknowledge ?? acknowledgeStorageDeletionJob)(job.key, job.storageKey, job.claimToken);
        continue;
      }
      let renewalError: unknown;
      let renewing = Promise.resolve();
      const renew = dependencies.renew ?? renewStorageDeletionClaim;
      const heartbeat = setInterval(() => {
        renewing = renewing.then(async () => {
          if (!await renew(job.key, job.storageKey, job.claimToken!)) throw new Error('Storage deletion claim heartbeat fence was lost');
        }).catch((error) => { renewalError = error; });
      }, dependencies.heartbeatMs ?? STORAGE_DELETION_HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        await (dependencies.storage ?? documentStorage).delete(job.storageKey);
      } finally {
        clearInterval(heartbeat);
        await renewing;
      }
      if (renewalError) throw renewalError;
      if (!await (dependencies.acknowledge ?? acknowledgeStorageDeletionJob)(job.key, job.storageKey, job.claimToken)) throw new Error('Storage deletion acknowledgement fence was lost');
      deleted += 1;
    } catch {
      if (job.claimToken) await (dependencies.release ?? releaseStorageDeletionJob)(job.key, job.storageKey, job.claimToken).catch(() => false);
      pending += 1;
    }
  }
  return { deleted, pending };
}
