import { closeStorageChargerQueue, startStorageCharger } from './storage-charger-queue';
import { closeStorageRetentionQueue, startStorageRetention } from './storage-retention-queue';
import { closeStorageDeletionQueue, startStorageDeletion } from './storage-deletion-queue';

type AutomationHandle = { close(): Promise<void> };
export async function startAutomations(): Promise<AutomationHandle> {
  const charger = await startStorageCharger();
  try {
    const retention = await startStorageRetention();
    try {
      const deletion = await startStorageDeletion();
      return { async close() { await Promise.all([charger.close(), retention.close(), deletion.close()]); } };
    } catch (error) { await retention.close(); throw error; }
  } catch (error) { await charger.close(); throw error; }
}
export async function closeAutomations() { await Promise.all([closeStorageDeletionQueue(), closeStorageRetentionQueue(), closeStorageChargerQueue()]); }
export * from './storage-charger';
export * from './storage-charger-queue';
export * from './storage-charger-repository';
export * from './storage-retention-queue';
export * from './storage-retention-repository';
export * from './storage-deletion-queue';
