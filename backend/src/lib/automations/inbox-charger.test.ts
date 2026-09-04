import { describe, expect, test } from 'bun:test';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { HOUR_MS } from './storage-charger';
import { calculateInboxCharge, calculateNextInboxHourCharge, INBOX_CHARGE_DENOMINATOR, processInboxChargingHour, type InboxChargingRepository, type PreparedInboxCharge } from './inbox-charger';

const window = (start: string) => ({ start, end: new Date(Date.parse(start) + HOUR_MS).toISOString() });

describe('connected inbox exact hourly billing', () => {
  test('charges exactly 100 Sparks after 730 full hours, not after 729', () => {
    let remainder = '0', total = 0n;
    for (let hour = 0; hour < 730; hour += 1) {
      const calculated = calculateInboxCharge(BigInt(HOUR_MS), remainder);
      total += BigInt(calculated.amountMicroSparks);
      remainder = calculated.remainder;
      if (hour === 728) expect(total).toBeLessThan(100_000_000n);
    }
    expect(total).toBe(100_000_000n);
    expect(remainder).toBe('0');
    expect(calculateNextInboxHourCharge('0')).toBe('136986');
  });

  test('carries fractions durably and honors boundary milliseconds', () => {
    const before = calculateInboxCharge(BigInt(HOUR_MS - 1));
    const boundary = calculateInboxCharge(1n, before.remainder);
    expect(BigInt(before.amountMicroSparks) + BigInt(boundary.amountMicroSparks)).toBe(100_000_000n / 730n);
    expect(BigInt(boundary.remainder)).toBeLessThan(INBOX_CHARGE_DENOMINATOR);
    expect(() => calculateInboxCharge(BigInt(HOUR_MS + 1))).toThrow('out of range');
  });
});

function memoryRepository(entries: Array<{ connectorKey: string; userKey: string; activeMilliseconds: string; payerAuthorized?: boolean }>) {
  const records = new Map<string, PreparedInboxCharge>(), remainders = new Map<string, string>(), suspended = new Set<string>(), recoveryPending = new Set<string>(), recovered: string[] = [], completed: string[] = [];
  const repository: InboxChargingRepository = {
    async assertHourReady() {},
    async listConnectorUsage() { return entries.filter(({ connectorKey }) => !suspended.has(connectorKey) || recoveryPending.has(connectorKey)).map((item) => ({ ...item, scopeKey: 'immutable-scope', payerAuthorized: item.payerAuthorized ?? true, recoveryPending: recoveryPending.has(item.connectorKey) })); },
    async prepareConnectorHour(input) {
      const key = `${input.connectorKey}:${input.start}`, replay = records.get(key); if (replay) return replay;
      const previousRemainder = remainders.get(input.connectorKey) ?? '0', charge = calculateInboxCharge(input.activeMilliseconds, previousRemainder);
      const prepared: PreparedInboxCharge = { ...input, hourStart: input.start, hourEnd: input.end, previousRemainder, ...charge, idempotencyKey: key, status: 'pending' };
      records.set(key, prepared); return prepared;
    },
    async completeConnectorHour(input) { remainders.set(input.connectorKey, input.remainder); records.set(`${input.connectorKey}:${input.hourStart}`, { ...input, status: 'completed' }); },
    async markConnectorHourUnfunded(input) { remainders.set(input.connectorKey, input.previousRemainder); suspended.add(input.connectorKey); records.set(`${input.connectorKey}:${input.hourStart}`, { ...input, status: 'unfunded' }); },
    async completeHour(input) { completed.push(input.start); },
    async activateConnectorAfterRecovery(connectorKey) { suspended.delete(connectorKey); recoveryPending.delete(connectorKey); recovered.push(connectorKey); return true; },
    async getUnfundedRecoveryCursor() { return null; },
    async listUnfundedConnectors(_afterKey, limit) { const items = [...suspended].slice(0, limit).map((connectorKey) => ({ connectorKey, userKey: entries.find((item) => item.connectorKey === connectorKey)!.userKey, remainder: remainders.get(connectorKey) ?? '0', nextHourMicroSparks: calculateNextInboxHourCharge(remainders.get(connectorKey) ?? '0') })); return { items, nextAfterKey: null }; },
    async beginConnectorFundingRecovery(connectorKey) { recoveryPending.add(connectorKey); return true; },
    async saveUnfundedRecoveryCursor() {},
  };
  return { repository, records, remainders, suspended, recoveryPending, recovered, completed };
}

describe('connected inbox hour processing', () => {
  const hour = window('2026-09-04T11:00:00.000Z'), now = () => new Date('2026-09-04T12:15:00.000Z');
  test('charges connectors independently, including multiple connectors owned by one user, and replays once', async () => {
    const memory = memoryRepository([
      { connectorKey: 'a', userKey: 'user-1', activeMilliseconds: String(HOUR_MS) },
      { connectorKey: 'b', userKey: 'user-1', activeMilliseconds: String(HOUR_MS) },
      { connectorKey: 'c', userKey: 'user-2', activeMilliseconds: String(HOUR_MS) },
    ]);
    const charges: string[] = [];
    const service = { async charge(input: PreparedInboxCharge) { charges.push(input.idempotencyKey); } };
    await processInboxChargingHour(hour, { repository: memory.repository, chargeService: service, now });
    await processInboxChargingHour(hour, { repository: memory.repository, chargeService: service, now });
    expect(charges).toEqual(['a:2026-09-04T11:00:00.000Z', 'b:2026-09-04T11:00:00.000Z', 'c:2026-09-04T11:00:00.000Z']);
  });

  test('keeps an insufficient connector suspended during a prospective recovery trial until its first debit succeeds', async () => {
    const memory = memoryRepository([{ connectorKey: 'a', userKey: 'user-1', activeMilliseconds: String(HOUR_MS) }, { connectorKey: 'b', userKey: 'user-2', activeMilliseconds: String(HOUR_MS) }]);
    const result = await processInboxChargingHour(hour, { repository: memory.repository, now, chargeService: {
      async charge(input) { if (input.connectorKey === 'a') throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'insufficient'); },
    } });
    expect(result).toMatchObject({ connectors: 2, chargedConnectors: 1, recoveryStarted: 1 });
    expect(memory.records.get(`a:${hour.start}`)?.status).toBe('unfunded');
    expect(memory.remainders.get('a')).toBe('0');
    expect(memory.recovered).toEqual([]);
    expect(memory.recoveryPending.has('a')).toBe(true);
    await processInboxChargingHour(window('2026-09-04T12:00:00.000Z'), { repository: memory.repository, now: () => new Date('2026-09-04T13:15:00.000Z'), chargeService: { async charge() {} } });
    expect(memory.recovered).toEqual(['a']);
  });

  test('starts only a bounded recovery page without a racy balance read', async () => {
    const memory = memoryRepository([{ connectorKey: 'a', userKey: 'user', activeMilliseconds: String(HOUR_MS) }, { connectorKey: 'b', userKey: 'user', activeMilliseconds: String(HOUR_MS) }]);
    memory.suspended.add('a'); memory.suspended.add('b');
    await processInboxChargingHour(hour, { repository: memory.repository, now, chargeService: { async charge() {} } });
    expect(memory.recovered).toEqual([]);
    expect(memory.recoveryPending).toEqual(new Set(['a', 'b']));
  });

  test('treats a missing billing user as terminal for the hour and rejects open hours', async () => {
    const memory = memoryRepository([{ connectorKey: 'gone', userKey: 'missing', activeMilliseconds: String(HOUR_MS) }]);
    await processInboxChargingHour(hour, { repository: memory.repository, now, chargeService: { async charge() { throw new SparkRepositoryError('USER_NOT_FOUND', 'missing'); } } });
    expect(memory.records.get(`gone:${hour.start}`)?.status).toBe('unfunded');
    await expect(processInboxChargingHour(window('2026-09-04T12:00:00.000Z'), { repository: memory.repository, now, chargeService: { async charge() {} } })).rejects.toThrow('fully closed');
  });

  test('suspends an invalid immutable payer authorization without attempting a debit', async () => {
    const memory = memoryRepository([{ connectorKey: 'unauthorized', userKey: 'user', activeMilliseconds: String(HOUR_MS), payerAuthorized: false }]);
    let charges = 0;
    await processInboxChargingHour(hour, { repository: memory.repository, now, chargeService: { async charge() { charges += 1; } } });
    expect(charges).toBe(0);
    expect(memory.records.get(`unauthorized:${hour.start}`)?.status).toBe('unfunded');
  });
});
