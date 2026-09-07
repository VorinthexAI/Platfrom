import { closeStorageChargerQueue, startStorageCharger, type StorageChargerDependencies } from './storage-charger-queue';
import { closeStorageRetentionQueue, startStorageRetention } from './storage-retention-queue';
import { closeStorageDeletionQueue, startStorageDeletion } from './storage-deletion-queue';
import { closeCommerceReconciliationQueue, startCommerceReconciliation, type CommerceReconciliationDependencies } from './commerce-reconciliation-queue';
import { closePolarWebhookQueue, startPolarWebhookWorker, type PolarWebhookWorkerDependencies } from './polar-webhook-queue';

type AutomationHandle = { close(): Promise<void> };
export interface AutomationDependencies { storage?: StorageChargerDependencies; commerce?: CommerceReconciliationDependencies; polarWebhook?: PolarWebhookWorkerDependencies }
async function startAllAutomations(dependencies: AutomationDependencies = {}): Promise<AutomationHandle> {
  const charger = await startStorageCharger(dependencies.storage);
  try {
    const retention = await startStorageRetention();
    try {
      const deletion = await startStorageDeletion();
      try {
        const polarWebhook = await startPolarWebhookWorker(dependencies.polarWebhook);
        try {
          const commerce = await startCommerceReconciliation(dependencies.commerce);
          return { async close() { const results = await Promise.allSettled([commerce.close(), polarWebhook.close(), deletion.close(), retention.close(), charger.close()]); const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected'); if (failed) throw failed.reason; } };
        } catch (error) {
          await Promise.allSettled([polarWebhook.close(), closePolarWebhookQueue(), deletion.close(), retention.close(), charger.close()]);
          throw error;
        }
      } catch (error) {
        await Promise.allSettled([closeCommerceReconciliationQueue(), deletion.close(), retention.close(), charger.close()]);
        throw error;
      }
    } catch (error) {
      await Promise.allSettled([closeStorageDeletionQueue(), retention.close(), charger.close()]);
      throw error;
    }
  } catch (error) {
    await charger.close().catch(() => undefined);
    throw error;
  }
}
async function closeAllQueues() {
  const results = await Promise.allSettled([closeCommerceReconciliationQueue(), closePolarWebhookQueue(), closeStorageDeletionQueue(), closeStorageRetentionQueue(), closeStorageChargerQueue()]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}
export function createAutomationLifecycle<Dependencies = StorageChargerDependencies>(starter: (dependencies?: Dependencies) => Promise<AutomationHandle> = startStorageCharger as (dependencies?: Dependencies) => Promise<AutomationHandle>, closeQueue = closeStorageChargerQueue) {
  let running: Promise<AutomationHandle> | undefined;
  let closing: Promise<void> | undefined;
  const launch = (dependencies: Dependencies) => starter(dependencies).catch((error) => { running = undefined; throw error; });
  return {
    start(dependencies: Dependencies = {} as Dependencies) {
      running ??= closing ? closing.then(() => launch(dependencies)) : launch(dependencies);
      return running;
    },
    close() {
      if (closing) return closing;
      const active = running;
      running = undefined;
      closing = (async () => {
        try {
          const handle = active ? await active : undefined;
          await handle?.close();
        } finally {
          await closeQueue();
        }
      })().finally(() => { closing = undefined; });
      return closing;
    },
  };
}

const lifecycle = createAutomationLifecycle(startAllAutomations, closeAllQueues);
export const startAutomations = lifecycle.start;
export const closeAutomations = lifecycle.close;

export * from './storage-charger';
export * from './storage-charger-queue';
export * from './storage-charger-repository';
export * from './storage-retention-queue';
export * from './storage-retention-repository';
export * from './storage-deletion-queue';
export * from './commerce-reconciliation';
export * from './commerce-reconciliation-queue';
export * from './commerce-reconciliation-repository';
export * from './polar-webhook-queue';
