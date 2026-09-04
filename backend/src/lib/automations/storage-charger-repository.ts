import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { calculateStorageCharge, closedStorageHours, storageByteUsageSchema, storageHourWindowSchema, type PreparedStorageCharge, type StorageHourWindow, type StorageUsageRepository } from './storage-charger';

export const STORAGE_OBJECTS_COLLECTION = 'storageObjects';
export const STORAGE_CHARGING_HOURS_COLLECTION = 'storageChargingHours';
export const STORAGE_CHARGING_METERS_COLLECTION = 'storageChargingMeters';
export const STORAGE_RETENTION_STATES_COLLECTION = 'storageRetentionStates';
export const STORAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const storageWipeDueAt = (failedAt: string) => new Date(Date.parse(z.string().datetime().parse(failedAt)) + STORAGE_RETENTION_MS).toISOString();

export const storageObjectSchema = z.object({
  key: z.string().min(1), storageKey: z.string().min(1).max(2_048), userKey: z.string().min(1).max(160), sizeBytes: z.string().regex(/^\d+$/), storedAt: z.string().datetime(), deletedAt: z.string().datetime().optional(),
}).strict();
export const storageChargingHourSchema = z.object({
  key: z.string().min(1), kind: z.enum(['user-hour', 'hour']), hourStart: z.string().datetime(), hourEnd: z.string().datetime(), status: z.enum(['pending', 'completed', 'unfunded']),
  userKey: z.string().min(1).max(160).optional(), byteMilliseconds: z.string().regex(/^\d+$/).optional(), amountMicroSparks: z.string().regex(/^\d+$/).optional(), remainder: z.string().regex(/^\d+$/).optional(), idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), completedAt: z.string().datetime().optional(),
});
export const storageChargingMeterSchema = z.object({ key: z.string().min(1), userKey: z.string().min(1).max(160), remainder: z.string().regex(/^\d+$/), lastHourEnd: z.string().datetime(), updatedAt: z.string().datetime() });

type QueryCursor = { all(): Promise<unknown[]> };
export interface StorageChargingDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<QueryCursor> }
type TransactionRunner = <T>(operation: (transaction: StorageChargingDatabase) => Promise<T>) => Promise<T>;

const stableKey = (kind: string, ...parts: string[]) => createHash('sha256').update([kind, ...parts].join('\0')).digest('hex');
export const storageUserHourId = (userKey: string, hourStart: string) => stableKey('storage-user-hour', userKey, hourStart);
export const storageHourId = (hourStart: string) => stableKey('storage-hour', hourStart);
const storageMeterId = (userKey: string) => stableKey('storage-meter', userKey);

const first = async (database: StorageChargingDatabase, query: string, bindVars?: Record<string, unknown>) => (await (await database.query(query, bindVars)).all())[0];

export function createStorageChargingRepository(
  database: StorageChargingDatabase = db as unknown as StorageChargingDatabase,
  transact: TransactionRunner = (operation) => withTransaction({ read: [STORAGE_OBJECTS_COLLECTION], write: [STORAGE_CHARGING_HOURS_COLLECTION, STORAGE_CHARGING_METERS_COLLECTION, STORAGE_RETENTION_STATES_COLLECTION] }, (transaction) => operation(transaction as unknown as StorageChargingDatabase)),
): StorageUsageRepository & { listMissedClosedHours(now: Date): Promise<StorageHourWindow[]> } {
  return {
    async listUserByteUsage(rawWindow) {
      const window = storageHourWindowSchema.parse(rawWindow);
      const cursor = await database.query(`FOR object IN @@objects FILTER object.storedAt < @end && (object.deletedAt == null || object.deletedAt > @start) LET user = DOCUMENT(users, object.userKey) FILTER user != null LET retention = FIRST(FOR state IN @@retention FILTER state.userKey == object.userKey LIMIT 1 RETURN state) FILTER retention == null || (retention.fundedAt != null && retention.fundedAt <= @start) SORT object.userKey ASC RETURN object`, { '@objects': STORAGE_OBJECTS_COLLECTION, '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...window });
      const totals = new Map<string, bigint>();
      for (const value of await cursor.all()) {
        const object = storageObjectSchema.parse(withArangoKey(value as Record<string, unknown>));
        const overlapStart = Math.max(Date.parse(object.storedAt), Date.parse(window.start));
        const overlapEnd = Math.min(object.deletedAt ? Date.parse(object.deletedAt) : Date.parse(window.end), Date.parse(window.end));
        if (overlapEnd <= overlapStart) continue;
        totals.set(object.userKey, (totals.get(object.userKey) ?? 0n) + BigInt(object.sizeBytes) * BigInt(overlapEnd - overlapStart));
      }
      return [...totals].map(([userKey, byteMilliseconds]) => storageByteUsageSchema.parse({ userKey, byteMilliseconds: byteMilliseconds.toString() }));
    },
    async prepareUserHour(raw) {
      const candidate = z.object({ ...storageByteUsageSchema.shape, start: z.string(), end: z.string() }).strict().parse(raw);
      const input = { ...storageByteUsageSchema.parse(candidate), ...storageHourWindowSchema.parse(candidate) };
      return transact(async (transaction) => {
        const key = storageUserHourId(input.userKey, input.start);
        const existing = await first(transaction, 'RETURN DOCUMENT(@@hours, @key)', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, key });
        if (existing) return storageChargingHourSchema.parse(withArangoKey(existing as Record<string, unknown>)) as PreparedStorageCharge;
        const earlierPending = await first(transaction, 'FOR hour IN @@hours FILTER hour.kind == "user-hour" && hour.userKey == @userKey && hour.status == "pending" && hour.hourStart < @hourStart LIMIT 1 RETURN true', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, userKey: input.userKey, hourStart: input.start });
        if (earlierPending) throw new Error('An earlier storage charge for this user is still pending.');
        const meterValue = await first(transaction, 'RETURN DOCUMENT(@@meters, @key)', { '@meters': STORAGE_CHARGING_METERS_COLLECTION, key: storageMeterId(input.userKey) });
        const previousRemainder = meterValue ? storageChargingMeterSchema.parse(withArangoKey(meterValue as Record<string, unknown>)).remainder : '0';
        const calculated = calculateStorageCharge(input.byteMilliseconds, previousRemainder);
        const prepared = storageChargingHourSchema.parse({ key, kind: 'user-hour', userKey: input.userKey, hourStart: input.start, hourEnd: input.end, byteMilliseconds: input.byteMilliseconds, ...calculated, idempotencyKey: stableKey('storage-charge', input.userKey, input.start), status: 'pending' });
        await transaction.query('INSERT @document INTO @@hours', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, document: toArangoDoc(prepared) });
        return prepared as PreparedStorageCharge;
      });
    },
    async completeUserHour(raw, completedAt) {
      const prepared = storageChargingHourSchema.parse({ key: storageUserHourId(raw.userKey, raw.hourStart), kind: 'user-hour', ...raw });
      await transact(async (transaction) => {
        const current = await first(transaction, 'RETURN DOCUMENT(@@hours, @key)', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, key: prepared.key });
        if (!current || storageChargingHourSchema.parse(withArangoKey(current as Record<string, unknown>)).status === 'completed') return;
        const meter = storageChargingMeterSchema.parse({ key: storageMeterId(prepared.userKey!), userKey: prepared.userKey, remainder: prepared.remainder, lastHourEnd: prepared.hourEnd, updatedAt: completedAt });
        await transaction.query('UPSERT { _key: @meterKey } INSERT @meter UPDATE @meter IN @@meters', { '@meters': STORAGE_CHARGING_METERS_COLLECTION, meterKey: meter.key, meter: toArangoDoc(meter) });
        await transaction.query('FOR hour IN @@hours FILTER hour._key == @key && hour.status == "pending" UPDATE hour WITH { status: "completed", completedAt: @completedAt } IN @@hours', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, key: prepared.key, completedAt });
      });
    },
    async markUserHourUnfunded(raw, failedAt) {
      const prepared = storageChargingHourSchema.parse({ key: storageUserHourId(raw.userKey, raw.hourStart), kind: 'user-hour', ...raw });
      const wipeDueAt = storageWipeDueAt(failedAt);
      await transact(async (transaction) => {
        const meter = storageChargingMeterSchema.parse({ key: storageMeterId(prepared.userKey!), userKey: prepared.userKey, remainder: prepared.remainder, lastHourEnd: prepared.hourEnd, updatedAt: failedAt });
        await transaction.query('UPSERT { _key: @meterKey } INSERT @meter UPDATE @meter IN @@meters', { '@meters': STORAGE_CHARGING_METERS_COLLECTION, meterKey: meter.key, meter: toArangoDoc(meter) });
        await transaction.query('FOR hour IN @@hours FILTER hour._key == @key && hour.status == "pending" UPDATE hour WITH { status: "unfunded", completedAt: @failedAt } IN @@hours', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, key: prepared.key, failedAt });
        await transaction.query('UPSERT { userKey: @userKey } INSERT { _key: @key, userKey: @userKey, paymentPastDueAt: @failedAt, wipeDueAt: @wipeDueAt, minimumBalanceMicroSparks: @minimumBalanceMicroSparks, wipeBatch: 0 } UPDATE (OLD.fundedAt != null || OLD.wipedAt != null ? { paymentPastDueAt: @failedAt, wipeDueAt: @wipeDueAt, minimumBalanceMicroSparks: @minimumBalanceMicroSparks, fundedAt: null, wipedAt: null, wipeStartedAt: null, wipeBatch: 0 } : {}) IN @@retention OPTIONS { keepNull: false }', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, key: storageRetentionStateId(prepared.userKey!), userKey: prepared.userKey, failedAt, wipeDueAt, minimumBalanceMicroSparks: Number(prepared.amountMicroSparks) });
      });
    },
    async completeHour(rawWindow, completedAt) {
      const window = storageHourWindowSchema.parse(rawWindow);
      const document = storageChargingHourSchema.parse({ key: storageHourId(window.start), kind: 'hour', hourStart: window.start, hourEnd: window.end, status: 'completed', completedAt });
      await database.query('UPSERT { _key: @key } INSERT @document UPDATE { status: "completed", completedAt: @completedAt } IN @@hours', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION, key: document.key, document: toArangoDoc(document), completedAt });
    },
    async listMissedClosedHours(now) {
      const oldest = await first(database, 'FOR object IN @@objects SORT object.storedAt ASC LIMIT 1 RETURN object.storedAt', { '@objects': STORAGE_OBJECTS_COLLECTION });
      const completedCursor = await database.query('FOR hour IN @@hours FILTER hour.kind == "hour" && hour.status == "completed" RETURN hour.hourStart', { '@hours': STORAGE_CHARGING_HOURS_COLLECTION });
      const completed = new Set(z.array(z.string().datetime()).parse(await completedCursor.all()));
      return closedStorageHours(null, now, typeof oldest === 'string' ? oldest : undefined).filter(({ start }) => !completed.has(start));
    },
  };
}

export const getDefaultStorageChargingRepository = () => createStorageChargingRepository();

export const storageRetentionStateId = (userKey: string) => stableKey('storage-retention', userKey);

export class StorageUnfundedError extends Error {
  readonly code = 'STORAGE_UNFUNDED';
  constructor() { super('Storage growth is unavailable until the Spark balance is positive.'); this.name = 'StorageUnfundedError'; }
}

export async function assertStorageGrowthAllowed(userKey: string, database: StorageChargingDatabase = db as unknown as StorageChargingDatabase) {
  const cursor = await database.query('LET state = FIRST(FOR value IN @@retention FILTER value.userKey == @userKey LIMIT 1 RETURN value) RETURN state == null || state.fundedAt != null', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, userKey: z.string().min(1).max(160).parse(userKey) });
  if ((await cursor.all())[0] !== true) throw new StorageUnfundedError();
}

export async function recordStoredObject(
  rawInput: { storageKey: string; userKey: string; sizeBytes: number; storedAt?: string },
  transact: TransactionRunner = (operation) => withTransaction({ write: [STORAGE_RETENTION_STATES_COLLECTION, STORAGE_OBJECTS_COLLECTION] }, (transaction) => operation(transaction as unknown as StorageChargingDatabase)),
) {
  if (!Number.isSafeInteger(rawInput.sizeBytes) || rawInput.sizeBytes < 0) throw new RangeError('Stored object size must be a nonnegative safe integer.');
  const storedAt = rawInput.storedAt ?? new Date().toISOString();
  const document = storageObjectSchema.parse({ key: newId(), storageKey: rawInput.storageKey, userKey: rawInput.userKey, sizeBytes: String(rawInput.sizeBytes), storedAt });
  await transact(async (transaction) => {
    const allowed = await first(transaction, 'LET state = FIRST(FOR value IN @@retention FILTER value.userKey == @userKey LIMIT 1 RETURN value) RETURN state == null || state.fundedAt != null', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, userKey: document.userKey });
    if (allowed !== true) throw new StorageUnfundedError();
    await transaction.query('FOR object IN @@objects FILTER object.storageKey == @storageKey && object.deletedAt == null && object.storedAt <= @storedAt UPDATE object WITH { deletedAt: @storedAt } IN @@objects', { '@objects': STORAGE_OBJECTS_COLLECTION, storageKey: document.storageKey, storedAt });
    await transaction.query('INSERT @document INTO @@objects', { '@objects': STORAGE_OBJECTS_COLLECTION, document: toArangoDoc(document) });
  });
  return document;
}

export async function markStoredObjectDeleted(
  storageKey: string,
  deletedAt = new Date().toISOString(),
  database: StorageChargingDatabase = db as unknown as StorageChargingDatabase,
) {
  const valid = z.object({ storageKey: storageObjectSchema.shape.storageKey, deletedAt: z.string().datetime() }).strict().parse({ storageKey, deletedAt });
  await database.query(`
    FOR object IN @@objects
      FILTER object.storageKey == @storageKey && object.deletedAt == null && object.storedAt <= @deletedAt
      UPDATE object WITH { deletedAt: @deletedAt } IN @@objects
  `, { '@objects': STORAGE_OBJECTS_COLLECTION, ...valid });
}

export async function markStoredObjectsDeleted(
  storageKeys: string[],
  deletedAt = new Date().toISOString(),
  database: StorageChargingDatabase = db as unknown as StorageChargingDatabase,
) {
  const valid = z.object({ storageKeys: z.array(storageObjectSchema.shape.storageKey).max(1000), deletedAt: z.string().datetime() }).strict().parse({ storageKeys: [...new Set(storageKeys)], deletedAt });
  if (valid.storageKeys.length === 0) return;
  await database.query('FOR object IN @@objects FILTER object.storageKey IN @storageKeys && object.deletedAt == null && object.storedAt <= @deletedAt UPDATE object WITH { deletedAt: @deletedAt } IN @@objects', { '@objects': STORAGE_OBJECTS_COLLECTION, ...valid });
}
