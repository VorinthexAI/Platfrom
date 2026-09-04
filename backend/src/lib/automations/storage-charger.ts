import { z } from 'zod';
import { BYTES_PER_GIB as COST_BYTES_PER_GIB, calculateStorageMicroSparks, STORAGE_BYTE_MILLISECOND_DENOMINATOR } from '@/lib/costs';
import { SparkRepositoryError } from '@/lib/sparks/repository';

export const HOUR_MS = 60 * 60 * 1_000;
export const BYTES_PER_GIB = BigInt(COST_BYTES_PER_GIB);
export const STORAGE_CHARGE_DENOMINATOR = STORAGE_BYTE_MILLISECOND_DENOMINATOR;

const hourTimestampSchema = z.string().datetime().refine((value) => Date.parse(value) % HOUR_MS === 0, 'Timestamp must be aligned to a UTC hour.');
export const storageHourWindowSchema = z.object({ start: hourTimestampSchema, end: hourTimestampSchema }).strict().refine(
  ({ start, end }) => Date.parse(end) - Date.parse(start) === HOUR_MS,
  'Storage charging windows must contain exactly one half-open UTC hour.',
);
export type StorageHourWindow = z.infer<typeof storageHourWindowSchema>;

export const storageByteUsageSchema = z.object({
  userKey: z.string().min(1).max(160),
  byteMilliseconds: z.string().regex(/^\d+$/),
}).strict();
export type StorageByteUsage = z.infer<typeof storageByteUsageSchema>;

export interface PreparedStorageCharge {
  status: 'pending' | 'completed' | 'unfunded';
  userKey: string;
  hourStart: string;
  hourEnd: string;
  byteMilliseconds: string;
  amountMicroSparks: string;
  remainder: string;
  idempotencyKey: string;
}

export interface StorageUsageRepository {
  listUserByteUsage(window: StorageHourWindow): Promise<StorageByteUsage[]>;
  prepareUserHour(input: StorageByteUsage & StorageHourWindow): Promise<PreparedStorageCharge>;
  completeUserHour(input: PreparedStorageCharge, completedAt: string): Promise<void>;
  markUserHourUnfunded(input: PreparedStorageCharge, failedAt: string): Promise<void>;
  completeHour(window: StorageHourWindow, completedAt: string): Promise<void>;
}

export interface StorageChargeService {
  charge(input: {
    userKey: string;
    amountMicroSparks: string;
    idempotencyKey: string;
    kind: 'storage';
    hourStart: string;
    hourEnd: string;
  }): Promise<unknown>;
}

export function floorUtcHour(value: Date): Date {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('A valid date is required.');
  return new Date(Math.floor(timestamp / HOUR_MS) * HOUR_MS);
}

export function latestClosedStorageHour(now: Date): StorageHourWindow {
  const end = floorUtcHour(now);
  return storageHourWindowSchema.parse({ start: new Date(end.getTime() - HOUR_MS).toISOString(), end: end.toISOString() });
}

export function closedStorageHours(afterEnd: string | null, now: Date, firstStart?: string): StorageHourWindow[] {
  const latestEnd = floorUtcHour(now).getTime();
  const initialStart = afterEnd === null
    ? (firstStart === undefined ? latestEnd - HOUR_MS : floorUtcHour(new Date(firstStart)).getTime())
    : Date.parse(hourTimestampSchema.parse(afterEnd));
  if (!Number.isFinite(initialStart)) throw new TypeError('A valid recovery boundary is required.');
  const windows: StorageHourWindow[] = [];
  for (let start = initialStart; start < latestEnd; start += HOUR_MS) {
    windows.push(storageHourWindowSchema.parse({ start: new Date(start).toISOString(), end: new Date(start + HOUR_MS).toISOString() }));
  }
  return windows;
}

export function calculateStorageCharge(byteMilliseconds: string | bigint, previousRemainder: string | bigint = 0n) {
  return calculateStorageMicroSparks(byteMilliseconds, previousRemainder);
}

export async function processStorageChargingHour(rawWindow: unknown, dependencies: {
  repository: StorageUsageRepository;
  chargeService: StorageChargeService;
  now?: () => Date;
}) {
  const window = storageHourWindowSchema.parse(rawWindow);
  if (Date.parse(window.end) > floorUtcHour((dependencies.now ?? (() => new Date()))()).getTime()) {
    throw new RangeError('Storage charging only accepts fully closed UTC hours.');
  }
  const usage = (await dependencies.repository.listUserByteUsage(window)).map((item) => storageByteUsageSchema.parse(item));
  usage.sort((left, right) => left.userKey.localeCompare(right.userKey));
  let chargedUsers = 0;
  let chargedMicroSparks = 0n;
  for (const item of usage) {
    const prepared = await dependencies.repository.prepareUserHour({ ...window, ...item });
    if (prepared.status !== 'pending') continue;
    if (BigInt(prepared.amountMicroSparks) > 0n) {
      try {
        await dependencies.chargeService.charge({
          userKey: prepared.userKey,
          amountMicroSparks: prepared.amountMicroSparks,
          idempotencyKey: prepared.idempotencyKey,
          kind: 'storage',
          hourStart: prepared.hourStart,
          hourEnd: prepared.hourEnd,
        });
      } catch (error) {
        if (!(error instanceof SparkRepositoryError && error.code === 'INSUFFICIENT_BALANCE')) throw error;
        await dependencies.repository.markUserHourUnfunded(prepared, (dependencies.now ?? (() => new Date()))().toISOString());
        continue;
      }
      chargedUsers += 1;
      chargedMicroSparks += BigInt(prepared.amountMicroSparks);
    }
    await dependencies.repository.completeUserHour(prepared, (dependencies.now ?? (() => new Date()))().toISOString());
  }
  await dependencies.repository.completeHour(window, (dependencies.now ?? (() => new Date()))().toISOString());
  return { users: usage.length, chargedUsers, chargedMicroSparks: chargedMicroSparks.toString() };
}
