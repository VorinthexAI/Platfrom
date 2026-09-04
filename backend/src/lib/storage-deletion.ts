import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { markStoredObjectsDeleted } from '@/lib/automations/storage-charger-repository';
import { STORAGE_DELETION_HEARTBEAT_MS, acknowledgeStorageDeletionJob, claimStorageDeletionJobs, releaseStorageDeletionJob, renewStorageDeletionClaim, resolveStorageDeletionClaim, type StorageDeletionJob } from '@/lib/db/storage-deletion-jobs.node';
import { s3, S3_BUCKET } from '@/lib/s3';

export const STORAGE_BULK_DELETE_LIMIT = 1000;
export type StorageDeletionDependencies = {
  list?: (limit: number) => Promise<StorageDeletionJob[]>;
  acknowledge?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  release?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  referenced?: (storageKey: string) => Promise<boolean>;
  resolveClaim?: (key: string, storageKey: string, claimToken: string) => Promise<'referenced' | 'unreferenced' | 'lost'>;
  renew?: (key: string, storageKey: string, claimToken: string) => Promise<boolean>;
  heartbeatMs?: number;
  storage?: Pick<DocumentStorage, 'delete'>;
  bulkDelete?: (storageKeys: string[]) => Promise<{ succeeded: string[]; failed: string[] }>;
  closeInventory?: (storageKeys: string[]) => Promise<void>;
};

export async function deleteStorageObjectsBulk(
  storageKeys: string[],
  client: { send(command: DeleteObjectsCommand): Promise<{ Deleted?: Array<{ Key?: string }>; Errors?: Array<{ Key?: string }> }> } = s3 as unknown as { send(command: DeleteObjectsCommand): Promise<{ Deleted?: Array<{ Key?: string }>; Errors?: Array<{ Key?: string }> }> },
  bucket = S3_BUCKET,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const keys = zStorageKeys(storageKeys);
  if (keys.length === 0) return { succeeded: [], failed: [] };
  const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: false } }));
  const failedSet = new Set((result.Errors ?? []).flatMap(({ Key }) => Key ? [Key] : []));
  const confirmed = new Set((result.Deleted ?? []).flatMap(({ Key }) => Key ? [Key] : []));
  return { succeeded: keys.filter((key) => confirmed.has(key) && !failedSet.has(key)), failed: keys.filter((key) => failedSet.has(key) || !confirmed.has(key)) };
}

function zStorageKeys(storageKeys: string[]) {
  if (storageKeys.length > STORAGE_BULK_DELETE_LIMIT) throw new RangeError(`S3 bulk deletion accepts at most ${STORAGE_BULK_DELETE_LIMIT} keys.`);
  return [...new Set(storageKeys.map((key) => {
    const normalized = key.trim();
    if (!normalized) throw new TypeError('A nonempty storage key is required.');
    return normalized;
  }))];
}

export async function drainStorageDeletionJobs(limit = 100, dependencies: StorageDeletionDependencies = {}): Promise<{ deleted: number; pending: number }> {
  const jobs = await (dependencies.list ?? claimStorageDeletionJobs)(limit);
  if (!dependencies.storage) return drainStorageDeletionJobsBulk(jobs, dependencies);
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

async function drainStorageDeletionJobsBulk(jobs: StorageDeletionJob[], dependencies: StorageDeletionDependencies): Promise<{ deleted: number; pending: number }> {
  const acknowledge = dependencies.acknowledge ?? acknowledgeStorageDeletionJob;
  const release = dependencies.release ?? releaseStorageDeletionJob;
  const deletable: StorageDeletionJob[] = [];
  let pending = 0;
  for (const job of jobs) {
    try {
      if (!job.claimToken) throw new Error('Storage deletion job was not atomically claimed');
      const decision = dependencies.referenced
        ? await dependencies.referenced(job.storageKey) ? 'referenced' : 'unreferenced'
        : await (dependencies.resolveClaim ?? resolveStorageDeletionClaim)(job.key, job.storageKey, job.claimToken);
      if (decision === 'lost') throw new Error('Storage deletion claim fence was lost before reference verification');
      if (decision === 'referenced') {
        if (dependencies.referenced) await acknowledge(job.key, job.storageKey, job.claimToken);
      } else deletable.push(job);
    } catch {
      if (job.claimToken) await release(job.key, job.storageKey, job.claimToken).catch(() => false);
      pending += 1;
    }
  }
  if (deletable.length === 0) return { deleted: 0, pending };

  let renewalError: unknown;
  let renewing = Promise.resolve();
  const renew = dependencies.renew ?? renewStorageDeletionClaim;
  const heartbeat = setInterval(() => {
    renewing = renewing.then(async () => {
      for (const job of deletable) if (!await renew(job.key, job.storageKey, job.claimToken!)) throw new Error('Storage deletion claim heartbeat fence was lost');
    }).catch((error) => { renewalError = error; });
  }, dependencies.heartbeatMs ?? STORAGE_DELETION_HEARTBEAT_MS);
  heartbeat.unref?.();
  let succeeded: string[] = [], failed: string[] = [];
  try {
    ({ succeeded, failed } = await (dependencies.bulkDelete ?? deleteStorageObjectsBulk)(deletable.map(({ storageKey }) => storageKey)));
  } catch {
    failed = deletable.map(({ storageKey }) => storageKey);
  } finally {
    clearInterval(heartbeat);
    await renewing;
  }
  if (renewalError) {
    succeeded = [];
    failed = deletable.map(({ storageKey }) => storageKey);
  }

  const succeededSet = new Set(succeeded);
  const failedSet = new Set(failed);
  const confirmed = deletable.filter(({ storageKey }) => succeededSet.has(storageKey) && !failedSet.has(storageKey));
  try {
    await (dependencies.closeInventory ?? markStoredObjectsDeleted)(confirmed.map(({ storageKey }) => storageKey));
  } catch {
    for (const job of deletable) await release(job.key, job.storageKey, job.claimToken!).catch(() => false);
    return { deleted: 0, pending: pending + deletable.length };
  }

  let deleted = 0;
  for (const job of deletable) {
    if (confirmed.includes(job)) {
      if (await acknowledge(job.key, job.storageKey, job.claimToken!)) deleted += 1;
      else { await release(job.key, job.storageKey, job.claimToken!).catch(() => false); pending += 1; }
    } else {
      await release(job.key, job.storageKey, job.claimToken!).catch(() => false);
      pending += 1;
    }
  }
  return { deleted, pending };
}
