import { STORAGE_UPLOAD_HEARTBEAT_MS, type StorageUploadReservation } from '@/lib/db/storage-deletion-jobs.node';

export function startStorageUploadHeartbeat(
  reservation: StorageUploadReservation,
  renew: (reservation: StorageUploadReservation) => Promise<boolean>,
  intervalMs = STORAGE_UPLOAD_HEARTBEAT_MS,
) {
  let failure: unknown;
  let active = Promise.resolve();
  const renewOwned = async () => {
    if (!await renew(reservation)) throw new Error('Storage upload reservation heartbeat fence was lost');
  };
  const timer = setInterval(() => {
    active = active.then(renewOwned).catch((error) => { failure = error; });
  }, intervalMs);
  timer.unref?.();
  return {
    async checkpoint() {
      await active;
      if (failure) throw failure;
      await renewOwned();
    },
    async stop() {
      clearInterval(timer);
      await active;
    },
  };
}
