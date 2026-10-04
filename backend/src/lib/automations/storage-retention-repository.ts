import { z } from 'zod';
import { calculateByteHours, formatMicroSparks, HOURS_PER_BILLING_MONTH, storageCostMicroSparks } from '@/lib/costs';
import { db, withTransaction } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { STORAGE_OBJECTS_COLLECTION, STORAGE_RETENTION_STATES_COLLECTION } from './storage-charger-repository';

export const storageRetentionStateSchema = z.object({
  key: z.string().min(1),
  userKey: z.string().min(1).max(160),
  paymentPastDueAt: z.string().datetime(),
  wipeDueAt: z.string().datetime(),
  minimumBalanceMicroSparks: z.number().int().positive().safe(),
  fundedAt: z.string().datetime().optional(),
  wipeBatch: z.number().int().nonnegative().optional(),
  wipeStartedAt: z.string().datetime().optional(),
  wipedAt: z.string().datetime().optional(),
  warningPaymentPastDueAt: z.string().datetime().optional(),
  warningWipeDueAt: z.string().datetime().optional(),
  warningSentAt: z.string().datetime().optional(),
}).strict();
export type StorageRetentionState = z.infer<typeof storageRetentionStateSchema>;

export const STORAGE_WIPE_BATCH_SIZE = 1000;
export const STORAGE_RETENTION_SCAN_BATCH_SIZE = 100;
const wipeInputSchema = z.object({ userKey: z.string().min(1).max(160), expectedWipeDueAt: z.string().datetime(), batch: z.number().int().nonnegative(), now: z.string().datetime() }).strict();
export type StorageWipeResult = { status: 'stale' } | { status: 'continued'; nextBatch: number; processed: number } | { status: 'wiped'; processed: number };
type Cursor = { all(): Promise<unknown[]>; next(): Promise<unknown> };
export interface StorageRetentionDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(operation: (transaction: StorageRetentionDatabase) => Promise<T>) => Promise<T>;

export const STORAGE_WIPE_COLLECTIONS = [
  'users', STORAGE_RETENTION_STATES_COLLECTION, STORAGE_OBJECTS_COLLECTION, 'storageDeletionJobs',
  'files', 'conversationAttachmentArtifacts',
] as const;

export interface StorageRetentionRepository {
  listUnfunded(input?: { afterKey?: string; limit?: number }): Promise<Array<StorageRetentionState & { balanceMicroSparks: number; spendingBlocked: boolean; storedBytes: string; monthlyCostSparks: string }>>;
  markFunded(userKey: string, fundedAt: string): Promise<boolean>;
  wipe(input: { userKey: string; expectedWipeDueAt: string; batch: number; now: string }): Promise<StorageWipeResult>;
}

export function storageMonthlyCostSparks(storedBytes: string): string {
  const bytes = BigInt(z.string().regex(/^\d+$/).parse(storedBytes));
  return formatMicroSparks(storageCostMicroSparks(calculateByteHours(bytes, HOURS_PER_BILLING_MONTH)));
}

export function createStorageRetentionRepository(
  database: StorageRetentionDatabase = db as unknown as StorageRetentionDatabase,
  transact: TransactionRunner = (operation) => withTransaction({ write: [...STORAGE_WIPE_COLLECTIONS] }, (transaction) => operation(transaction as unknown as StorageRetentionDatabase)),
): StorageRetentionRepository {
  return {
    async listUnfunded(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? STORAGE_RETENTION_SCAN_BATCH_SIZE, 1), STORAGE_RETENTION_SCAN_BATCH_SIZE);
      const cursor = await database.query('FOR state IN @@retention FILTER state.fundedAt == null && state._key > @afterKey SORT state._key ASC LIMIT @limit LET user = DOCUMENT(users, state.userKey) LET balanceMicroSparks = user != null && IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0 LET spendingBlocked = user != null && IS_NUMBER(user.microSparkDebt) && user.microSparkDebt > 0 LET storedByteSizes = (FOR object IN @@objects FILTER object.userKey == state.userKey && object.deletedAt == null RETURN object.sizeBytes) RETURN { state, balanceMicroSparks, spendingBlocked, storedByteSizes }', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, '@objects': STORAGE_OBJECTS_COLLECTION, afterKey: input.afterKey ?? '', limit });
      return (await cursor.all()).map((raw) => {
        const value = raw as { state: Record<string, unknown>; balanceMicroSparks: unknown; spendingBlocked: unknown; storedByteSizes: unknown };
        const balanceMicroSparks = z.number().int().nonnegative().safe().parse(value.balanceMicroSparks);
        const spendingBlocked = z.boolean().parse(value.spendingBlocked);
        const storedBytes = z.array(z.string().regex(/^\d+$/)).parse(value.storedByteSizes).reduce((total, size) => total + BigInt(size), 0n).toString();
        return { ...storageRetentionStateSchema.parse(withArangoKey(value.state)), balanceMicroSparks, spendingBlocked, storedBytes, monthlyCostSparks: storageMonthlyCostSparks(storedBytes) };
      });
    },

    async markFunded(userKey, fundedAt) {
      const valid = z.object({ userKey: storageRetentionStateSchema.shape.userKey, fundedAt: z.string().datetime() }).strict().parse({ userKey, fundedAt });
      const cursor = await database.query('FOR state IN @@retention FILTER state.userKey == @userKey && state.fundedAt == null && state.wipeStartedAt == null LET user = DOCUMENT(users, state.userKey) FILTER user != null && (!IS_NUMBER(user.microSparkDebt) || user.microSparkDebt == 0) && IS_NUMBER(user.microSparkBalance) && user.microSparkBalance >= state.minimumBalanceMicroSparks UPDATE state WITH { fundedAt: @fundedAt } IN @@retention RETURN true', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...valid });
      return await cursor.next() === true;
    },

    async wipe(rawInput) {
      const input = wipeInputSchema.parse(rawInput);
      return transact(async (transaction) => {
        const eligible = await transaction.query('LET state = FIRST(FOR value IN @@retention FILTER value.userKey == @userKey LIMIT 1 RETURN value) LET user = DOCUMENT(users, @userKey) LET currentBatch = state != null && IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 LET spendingBlocked = user != null && IS_NUMBER(user.microSparkDebt) && user.microSparkDebt > 0 FILTER state != null && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null && state.wipeDueAt <= @now && ((@batch == 0 && state.wipeStartedAt == null && (user == null || spendingBlocked || !IS_NUMBER(user.microSparkBalance) || user.microSparkBalance < state.minimumBalanceMicroSparks)) || (@batch > 0 && state.wipeStartedAt != null)) RETURN true', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...input });
        if (await eligible.next() !== true) return { status: 'stale' };

        // Include metadata references even if an upload predates the storage inventory.
        const rows = await transaction.query('LET user = DOCUMENT(users, @userKey) LET keys = UNIQUE(UNION((FOR object IN @@objects FILTER object.userKey == @userKey && object.deletedAt == null RETURN object.storageKey), (FOR file IN files FILTER file.userKey == @userKey FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) RETURN key), (FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey RETURN artifact.stagedStorageKey), user != null && IS_STRING(user.profileStorageKey) ? [user.profileStorageKey] : [])) FOR storageKey IN keys FILTER IS_STRING(storageKey) && LENGTH(storageKey) > 0 SORT storageKey ASC LIMIT @batchSize RETURN storageKey', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey, batchSize: STORAGE_WIPE_BATCH_SIZE });
        const storageKeys = z.array(z.string().min(1)).parse(await rows.all());
        const bind = { storageKeys, now: input.now };

        await transaction.query('FOR user IN users FILTER user._key == @userKey && user.profileStorageKey IN @storageKeys UPDATE user WITH { profileStorageKey: null, updatedAt: @now } IN users OPTIONS { keepNull: false }', { ...bind, userKey: input.userKey });
        await transaction.query('FOR file IN files FILTER file.userKey == @userKey && (file.storageKey IN @storageKeys || file.thumbnailStorageKey IN @storageKeys) REMOVE file IN files', { ...bind, userKey: input.userKey });
        await transaction.query('FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey && artifact.stagedStorageKey IN @storageKeys REMOVE artifact IN conversationAttachmentArtifacts', { ...bind, userKey: input.userKey });

        await transaction.query('FOR storageKey IN UNIQUE(@storageKeys) UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE { status: "pending", claimToken: null, claimedAt: null, reservationExpiresAt: null } IN storageDeletionJobs OPTIONS { keepNull: false }', bind);
        await transaction.query('FOR object IN @@objects FILTER object.userKey == @userKey && object.storageKey IN @storageKeys && object.deletedAt == null UPDATE object WITH { deletedAt: @now } IN @@objects', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey, ...bind });
        const remaining = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN (LENGTH(FOR object IN @@objects FILTER object.userKey == @userKey && object.deletedAt == null LIMIT 1 RETURN 1) > 0 || LENGTH(FOR file IN files FILTER file.userKey == @userKey LIMIT 1 RETURN 1) > 0 || LENGTH(FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey LIMIT 1 RETURN 1) > 0 || (user != null && IS_STRING(user.profileStorageKey)))', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey });
        const hasMore = await remaining.next() === true;
        const nextBatch = input.batch + 1;
        const update = hasMore
          ? 'FOR state IN @@retention LET currentBatch = IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 FILTER state.userKey == @userKey && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null UPDATE state WITH { wipeStartedAt: state.wipeStartedAt == null ? @now : state.wipeStartedAt, wipeBatch: @nextBatch } IN @@retention RETURN true'
          : 'FOR state IN @@retention LET currentBatch = IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 FILTER state.userKey == @userKey && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null UPDATE state WITH { wipeStartedAt: state.wipeStartedAt == null ? @now : state.wipeStartedAt, wipedAt: @now } IN @@retention RETURN true';
        const fenced = await transaction.query(update, { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...input, nextBatch });
        if (await fenced.next() !== true) throw new Error('Storage retention state changed during wipe.');
        return hasMore ? { status: 'continued', nextBatch, processed: storageKeys.length } : { status: 'wiped', processed: storageKeys.length };
      });
    },
  };
}

export const getDefaultStorageRetentionRepository = () => createStorageRetentionRepository();
