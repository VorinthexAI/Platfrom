import { describe, expect, test } from 'bun:test';
import { HOUR_MS } from './storage-charger';
import { createStorageChargingRepository, markStoredObjectDeleted, recordStoredObject, storageChargingHourSchema, storageChargingMeterSchema, storageObjectSchema, storageUserHourId } from './storage-charger-repository';

const start = '2026-09-04T11:00:00.000Z';
const end = '2026-09-04T12:00:00.000Z';

describe('storage charging repository contract', () => {
  test('models storage inventory, durable hour records, and exact meter strings', () => {
    expect(storageObjectSchema.parse({ key: 'object-1', storageKey: 'objects/one', userKey: 'user-1', sizeBytes: '90071992547409930', storedAt: start })).toMatchObject({ sizeBytes: '90071992547409930' });
    expect(storageChargingHourSchema.parse({ key: 'hour-1', kind: 'hour', hourStart: start, hourEnd: end, status: 'completed', completedAt: end }).kind).toBe('hour');
    expect(storageChargingMeterSchema.parse({ key: 'meter-1', userKey: 'user-1', remainder: '123', lastHourEnd: end, updatedAt: end }).remainder).toBe('123');
    expect(storageUserHourId('user-1', start)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('aggregates half-open object lifetimes by user with BigInt arithmetic', async () => {
    const rows = [
      { _key: 'one', storageKey: 'objects/one', userKey: 'user-1', sizeBytes: '10', storedAt: new Date(Date.parse(start) - HOUR_MS).toISOString(), deletedAt: new Date(Date.parse(start) + HOUR_MS / 2).toISOString() },
      { _key: 'two', storageKey: 'objects/two', userKey: 'user-1', sizeBytes: '90071992547409930', storedAt: new Date(Date.parse(start) + HOUR_MS / 2).toISOString() },
      { _key: 'three', storageKey: 'objects/three', userKey: 'user-2', sizeBytes: '7', storedAt: start, deletedAt: end },
    ];
    const database = { async query() { return { async all() { return rows; } }; } };
    const repository = createStorageChargingRepository(database);
    const usage = await repository.listUserByteUsage({ start, end });
    expect(usage).toEqual([
      { userKey: 'user-1', byteMilliseconds: (10n * BigInt(HOUR_MS / 2) + 90_071_992_547_409_930n * BigInt(HOUR_MS / 2)).toString() },
      { userKey: 'user-2', byteMilliseconds: (7n * BigInt(HOUR_MS)).toString() },
    ]);
  });

  test('records object lifetimes transactionally and closes them after deletion', async () => {
    const transactionQueries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const transact = async <T>(operation: (database: { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }) => Promise<T>) => operation({
      async query(query, bindVars) { transactionQueries.push({ query, bindVars }); return { async all() { return query.includes('LET state = FIRST') ? [true] : []; } }; },
    });
    const document = await recordStoredObject({ storageKey: 'objects/new', userKey: 'user-1', sizeBytes: 42, storedAt: start }, transact);
    expect(document).toMatchObject({ storageKey: 'objects/new', userKey: 'user-1', sizeBytes: '42', storedAt: start });
    expect(transactionQueries).toHaveLength(3);
    expect(transactionQueries[0]!.query).toContain('LET state = FIRST');
    expect(transactionQueries[1]!.query).toContain('deletedAt == null');
    expect(transactionQueries[1]!.query).toContain('object.storedAt <= @storedAt');
    expect(transactionQueries[2]!.query).toContain('INSERT @document');

    const deletionQueries: Array<Record<string, unknown> | undefined> = [];
    await markStoredObjectDeleted('objects/new', end, { async query(_query, bindVars) { deletionQueries.push(bindVars); return { async all() { return []; } }; } });
    expect(deletionQueries).toEqual([{ '@objects': 'storageObjects', storageKey: 'objects/new', deletedAt: end }]);
  });

  test('applies exact half-open lifetime boundaries without edge double charging', async () => {
    const rows = [
      { _key: 'ends-at-start', storageKey: 'objects/a', userKey: 'user-1', sizeBytes: '10', storedAt: new Date(Date.parse(start) - 1).toISOString(), deletedAt: start },
      { _key: 'starts-at-end', storageKey: 'objects/b', userKey: 'user-1', sizeBytes: '10', storedAt: end },
      { _key: 'first-ms', storageKey: 'objects/c', userKey: 'user-1', sizeBytes: '7', storedAt: start, deletedAt: new Date(Date.parse(start) + 1).toISOString() },
      { _key: 'last-ms', storageKey: 'objects/d', userKey: 'user-2', sizeBytes: '11', storedAt: new Date(Date.parse(end) - 1).toISOString(), deletedAt: end },
    ];
    const repository = createStorageChargingRepository({ async query() { return { async all() { return rows; } }; } });
    expect(await repository.listUserByteUsage({ start, end })).toEqual([
      { userKey: 'user-1', byteMilliseconds: '7' },
      { userKey: 'user-2', byteMilliseconds: '11' },
    ]);
  });

  test('recovers non-contiguous missing hours instead of trusting the latest checkpoint', async () => {
    const database = { async query(query: string) { return { async all() {
      if (query.includes('SORT object.storedAt ASC')) return ['2026-09-04T09:00:00.000Z'];
      if (query.includes('RETURN hour.hourStart')) return ['2026-09-04T09:00:00.000Z', '2026-09-04T11:00:00.000Z'];
      return [];
    } }; } };
    const repository = createStorageChargingRepository(database);
    expect((await repository.listMissedClosedHours(new Date('2026-09-04T13:00:00.000Z'))).map(({ start: value }) => value)).toEqual([
      '2026-09-04T10:00:00.000Z', '2026-09-04T12:00:00.000Z',
    ]);
  });

  test('excludes orphaned inventory from charging', async () => {
    let source = '';
    const repository = createStorageChargingRepository({ async query(query: string) { source = query; return { async all() { return []; } }; } });
    await repository.listUserByteUsage({ start, end });
    expect(source).toContain('LET user = DOCUMENT(users, object.userKey) FILTER user != null');
  });

  test('preserves the first active unfunded deadline and records the balance required to resume', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const transaction = { async query(query: string, bindVars?: Record<string, unknown>) { queries.push({ query, bindVars }); return { async all() { return []; } }; } };
    const repository = createStorageChargingRepository(transaction, async (operation) => operation(transaction));
    await repository.markUserHourUnfunded({ status: 'pending', userKey: 'user-1', hourStart: start, hourEnd: end, byteMilliseconds: '1', amountMicroSparks: '7', remainder: '0', idempotencyKey: 'a'.repeat(64) }, end);
    const retention = queries.find(({ query }) => query.includes('UPSERT { userKey: @userKey }'))!;
    expect(retention.query).toContain('OLD.fundedAt != null || OLD.wipedAt != null');
    expect(retention.query).toContain('wipeStartedAt: null, wipeBatch: 0');
    expect(retention.query).toContain('minimumBalanceMicroSparks: @minimumBalanceMicroSparks, wipeBatch: 0');
    expect(retention.bindVars).toMatchObject({ minimumBalanceMicroSparks: 7, failedAt: end });
  });
});
