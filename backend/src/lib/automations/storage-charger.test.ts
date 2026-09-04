import { describe, expect, test } from 'bun:test';
import { HOUR_MS, STORAGE_CHARGE_DENOMINATOR, BYTES_PER_GIB, calculateStorageCharge, closedStorageHours, floorUtcHour, latestClosedStorageHour, processStorageChargingHour, storageHourWindowSchema, type PreparedStorageCharge, type StorageByteUsage, type StorageHourWindow, type StorageUsageRepository } from './storage-charger';
import { createStorageChargeService } from './storage-charger-queue';
import { SparkRepositoryError } from '@/lib/sparks/repository';

const hour = (start: string): StorageHourWindow => ({ start, end: new Date(Date.parse(start) + HOUR_MS).toISOString() });

describe('storage charging windows', () => {
  test('floors UTC instants and returns only the prior closed half-open hour', () => {
    expect(floorUtcHour(new Date('2026-03-08T01:59:59.999-08:00')).toISOString()).toBe('2026-03-08T09:00:00.000Z');
    expect(latestClosedStorageHour(new Date('2026-09-04T12:34:56.000Z'))).toEqual(hour('2026-09-04T11:00:00.000Z'));
    expect(latestClosedStorageHour(new Date('2026-09-04T12:00:00.000Z'))).toEqual(hour('2026-09-04T11:00:00.000Z'));
  });

  test('strictly validates one aligned UTC hour', () => {
    expect(() => storageHourWindowSchema.parse({ ...hour('2026-09-04T11:00:00.000Z'), extra: true })).toThrow();
    expect(() => storageHourWindowSchema.parse({ start: '2026-09-04T11:30:00.000Z', end: '2026-09-04T12:30:00.000Z' })).toThrow('aligned');
    expect(() => storageHourWindowSchema.parse({ start: '2026-09-04T11:00:00.000Z', end: '2026-09-04T13:00:00.000Z' })).toThrow('exactly one');
  });

  test('builds missed hours oldest first and excludes the open hour', () => {
    expect(closedStorageHours('2026-09-04T09:00:00.000Z', new Date('2026-09-04T12:45:00.000Z')).map(({ start }) => start)).toEqual([
      '2026-09-04T09:00:00.000Z', '2026-09-04T10:00:00.000Z', '2026-09-04T11:00:00.000Z',
    ]);
  });
});

describe('exact storage charge arithmetic', () => {
  test('charges exactly 24 Sparks per GiB across 730 full hours', () => {
    const usage = BYTES_PER_GIB * BigInt(HOUR_MS);
    let remainder = '0';
    let total = 0n;
    for (let index = 0; index < 730; index += 1) {
      const charge = calculateStorageCharge(usage, remainder);
      total += BigInt(charge.amountMicroSparks);
      remainder = charge.remainder;
    }
    expect(total).toBe(24_000_000n);
    expect(remainder).toBe('0');
  });

  test('preserves fractional micros and accepts values beyond safe integers', () => {
    const first = calculateStorageCharge(1n);
    expect(first.amountMicroSparks).toBe('0');
    expect(first.remainder).toBe('24000000');
    const huge = calculateStorageCharge(BigInt(Number.MAX_SAFE_INTEGER) * BigInt(HOUR_MS), first.remainder);
    expect(BigInt(huge.remainder)).toBeLessThan(STORAGE_CHARGE_DENOMINATOR);
    expect(BigInt(huge.amountMicroSparks)).toBeGreaterThan(0n);
  });
});

function memoryRepository(items: StorageByteUsage[]): StorageUsageRepository & { records: Map<string, PreparedStorageCharge>; completedHours: string[] } {
  const records = new Map<string, PreparedStorageCharge>();
  let remainder = '0';
  const completedHours: string[] = [];
  return {
    records, completedHours,
    async listUserByteUsage() { return items; },
    async prepareUserHour(input) {
      const key = `${input.userKey}:${input.start}`;
      const existing = records.get(key);
      if (existing) return existing;
      const charge = calculateStorageCharge(input.byteMilliseconds, remainder);
      const prepared: PreparedStorageCharge = { status: 'pending', userKey: input.userKey, hourStart: input.start, hourEnd: input.end, byteMilliseconds: input.byteMilliseconds, ...charge, idempotencyKey: key };
      records.set(key, prepared);
      return prepared;
    },
    async completeUserHour(input) { remainder = input.remainder; records.set(`${input.userKey}:${input.hourStart}`, { ...input, status: 'completed' }); },
    async markUserHourUnfunded(input) { remainder = input.remainder; records.set(`${input.userKey}:${input.hourStart}`, { ...input, status: 'unfunded' }); },
    async completeHour(window) { completedHours.push(window.end); },
  };
}

describe('storage hour processing', () => {
  const window = hour('2026-09-04T11:00:00.000Z');
  const now = () => new Date('2026-09-04T12:10:00.000Z');

  test('creates one deterministic user charge and safely replays a completed hour', async () => {
    const repository = memoryRepository([{ userKey: 'user-1', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() }]);
    const calls: unknown[] = [];
    const chargeService = { async charge(input: unknown) { calls.push(input); } } as any;
    await processStorageChargingHour(window, { repository, chargeService, now });
    await processStorageChargingHour(window, { repository, chargeService, now });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userKey: 'user-1', kind: 'storage', hourStart: window.start, hourEnd: window.end });
  });

  test('leaves a prepared transaction pending when charging fails so BullMQ can retry it', async () => {
    const repository = memoryRepository([{ userKey: 'user-1', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() }]);
    const ids: string[] = [];
    await expect(processStorageChargingHour(window, { repository, chargeService: { async charge() { throw new Error('temporary'); } }, now })).rejects.toThrow('temporary');
    expect([...repository.records.values()][0]?.status).toBe('pending');
    expect(repository.completedHours).toEqual([]);
    await processStorageChargingHour(window, { repository, chargeService: { async charge(input) { ids.push(input.idempotencyKey); } }, now });
    expect(ids).toEqual(['user-1:2026-09-04T11:00:00.000Z']);
    expect([...repository.records.values()][0]?.status).toBe('completed');
  });

  test('terminates only an insufficient user-hour and continues charging other users', async () => {
    const repository = memoryRepository([
      { userKey: 'user-1', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() },
      { userKey: 'user-2', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() },
    ]);
    const charged: string[] = [];
    await processStorageChargingHour(window, { repository, now, chargeService: { async charge(input) {
      if (input.userKey === 'user-1') throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'insufficient');
      charged.push(input.userKey);
    } } });
    expect(repository.records.get(`user-1:${window.start}`)?.status).toBe('unfunded');
    expect(repository.records.get(`user-2:${window.start}`)?.status).toBe('completed');
    expect(charged).toEqual(['user-2']);
    expect(repository.completedHours).toEqual([window.end]);
  });

  test('replays an unfunded hour without retrying the debit or extending retention', async () => {
    const repository = memoryRepository([{ userKey: 'user-1', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() }]);
    let chargeCalls = 0, unfundedTransitions = 0;
    const mark = repository.markUserHourUnfunded.bind(repository);
    repository.markUserHourUnfunded = async (...args) => { unfundedTransitions += 1; await mark(...args); };
    const chargeService = { async charge() { chargeCalls += 1; throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'insufficient'); } };
    await processStorageChargingHour(window, { repository, chargeService, now });
    await processStorageChargingHour(window, { repository, chargeService, now });
    expect({ chargeCalls, unfundedTransitions }).toEqual({ chargeCalls: 1, unfundedTransitions: 1 });
    expect(repository.records.get(`user-1:${window.start}`)?.status).toBe('unfunded');
  });

  test('completes an empty closed hour without charges', async () => {
    const repository = memoryRepository([]);
    let charges = 0;
    await expect(processStorageChargingHour(window, { repository, now, chargeService: { async charge() { charges += 1; } } })).resolves.toEqual({ users: 0, chargedUsers: 0, chargedMicroSparks: '0' });
    expect(charges).toBe(0);
    expect(repository.completedHours).toEqual([window.end]);
  });

  test('rejects an open or future hour before reading usage', async () => {
    let reads = 0;
    const repository = memoryRepository([]);
    repository.listUserByteUsage = async () => { reads += 1; return []; };
    await expect(processStorageChargingHour(hour('2026-09-04T12:00:00.000Z'), { repository, chargeService: { async charge() {} }, now })).rejects.toThrow('fully closed');
    expect(reads).toBe(0);
  });

  test('replays one debit and completes the hour after analytics recovers', async () => {
    const repository = memoryRepository([{ userKey: 'user-1', byteMilliseconds: (BYTES_PER_GIB * BigInt(HOUR_MS)).toString() }]);
    let appliedDebits = 0, chargeCalls = 0, eventCalls = 0; let originalEventKey = '';
    const chargeService = createStorageChargeService({
      id: () => `event-${chargeCalls + 1}`, hash: async () => 'a'.repeat(64),
      charge: async (_userKey, input) => {
        chargeCalls += 1;
        if (chargeCalls === 1) { appliedDebits += 1; originalEventKey = input.eventKey!; return { status: 'applied', transaction: { key: 'transaction-1', eventKey: originalEventKey } } as never; }
        return { status: 'replayed', transaction: { key: 'transaction-1', eventKey: originalEventKey } } as never;
      },
      getUser: async () => ({ key: 'user-1', currentScopeKey: 'scope-1' }) as never,
      record: async (_input, options) => { eventCalls += 1; expect(options?.key).toBe(originalEventKey); if (eventCalls === 1) throw new Error('analytics unavailable'); },
    });
    await expect(processStorageChargingHour(window, { repository, chargeService, now })).rejects.toThrow('analytics unavailable');
    expect([...repository.records.values()][0]?.status).toBe('pending');
    await processStorageChargingHour(window, { repository, chargeService, now });
    expect({ appliedDebits, chargeCalls, eventCalls }).toEqual({ appliedDebits: 1, chargeCalls: 2, eventCalls: 2 });
    expect([...repository.records.values()][0]?.status).toBe('completed');
  });
});
