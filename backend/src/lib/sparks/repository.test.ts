import { describe, expect, test } from 'bun:test';
import { createArangoSparkRepository, SparkRepositoryError, type SparkDatabase, type SparkTransactionRunner } from './repository';

const rawRecord = {
  _key: 'transaction-1',
  userKey: 'user-1',
  kind: 'adjustment',
  deltaMicroSparks: 10,
  balanceAfterMicroSparks: 10,
  idempotencyKey: 'operation-1',
  requestHash: '0123456789abcdef',
  createdAt: '2026-09-04T10:00:00.000Z',
};

const input = {
  key: 'transaction-1',
  userKey: 'user-1',
  kind: 'adjustment' as const,
  deltaMicroSparks: 10,
  idempotencyKey: 'operation-1',
  requestHash: '0123456789abcdef',
  createdAt: '2026-09-04T10:00:00.000Z',
};

function cursor(next: unknown = undefined, all: unknown[] = []) {
  return { next: async () => next, all: async () => all };
}

describe('Arango Spark repository', () => {
  test('applies balance and ledger writes in one exclusive transaction', async () => {
    const declarations: unknown[] = [];
    const queries: Array<{ query: string; bind?: Record<string, unknown> }> = [];
    const database: SparkDatabase = { query: async () => cursor() };
    const transact: SparkTransactionRunner = async (collections, operation) => {
      declarations.push(collections);
      return operation({
        query: async (query, bind) => {
          queries.push({ query, bind });
          return query.includes('FILTER item.userKey') ? cursor() : cursor(rawRecord);
        },
      });
    };
    const repository = createArangoSparkRepository(database, transact);
    await expect(repository.apply(input)).resolves.toMatchObject({ status: 'applied', transaction: { key: 'transaction-1', balanceAfterMicroSparks: 10 } });
    expect(declarations).toEqual([{ write: ['users', 'sparkTransactions'] }]);
    expect(queries[1].query).toContain('UPDATE user WITH { microSparkBalance: nextBalance }');
    expect(queries[1].query).toContain('INSERT ledgerRecord INTO sparkTransactions');
    expect(queries[1].bind?.record).toMatchObject({ _key: 'transaction-1' });
    expect(queries[1].bind?.record).not.toHaveProperty('key');
  });

  test('replays matching hashes and reports conflicting reuse without writing', async () => {
    let queryCount = 0;
    const transact: SparkTransactionRunner = async (_collections, operation) => operation({ query: async () => { queryCount += 1; return cursor(rawRecord); } });
    const repository = createArangoSparkRepository({ query: async () => cursor() }, transact);
    await expect(repository.apply(input)).resolves.toMatchObject({ status: 'replayed' });
    await expect(repository.apply({ ...input, deltaMicroSparks: -999, kind: 'refund' })).resolves.toMatchObject({ status: 'replayed', transaction: { deltaMicroSparks: 10, kind: 'adjustment' } });
    await expect(repository.apply({ ...input, requestHash: 'fedcba9876543210' })).resolves.toMatchObject({ status: 'conflict', transaction: { requestHash: '0123456789abcdef' } });
    expect(queryCount).toBe(3);
  });

  test('distinguishes missing users, insufficient balances, invalid balances, and overflow', async () => {
    const missing: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => query.includes('RETURN user == null') ? cursor(null) : cursor() });
    await expect(createArangoSparkRepository({ query: async () => cursor() }, missing).apply(input)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    const insufficient: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => query.includes('RETURN user == null') ? cursor(5) : cursor() });
    await expect(createArangoSparkRepository({ query: async () => cursor() }, insufficient).apply({ ...input, deltaMicroSparks: -10 })).rejects.toEqual(new SparkRepositoryError('INSUFFICIENT_BALANCE', 'Spark balance is insufficient for this transaction.'));
    const invalid: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => query.includes('RETURN user == null') ? cursor(-1) : cursor() });
    await expect(createArangoSparkRepository({ query: async () => cursor() }, invalid).apply(input)).rejects.toMatchObject({ code: 'INVALID_BALANCE' });
    const overflow: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => query.includes('RETURN user == null') ? cursor(Number.MAX_SAFE_INTEGER) : cursor() });
    await expect(createArangoSparkRepository({ query: async () => cursor() }, overflow).apply(input)).rejects.toEqual(new SparkRepositoryError('BALANCE_OVERFLOW', 'Spark balance would exceed the safe integer range.'));
  });

  test('propagates transaction failure', async () => {
    const failure = new Error('abort');
    const failing: SparkTransactionRunner = async () => { throw failure; };
    await expect(createArangoSparkRepository({ query: async () => cursor() }, failing).apply(input)).rejects.toBe(failure);
  });

  test('reads zero for an uninitialized user balance and returns public history keys', async () => {
    const queries: string[] = [];
    const database: SparkDatabase = {
      query: async (query) => {
        queries.push(query);
        return query.includes('DOCUMENT(users') ? cursor(0) : cursor(undefined, [rawRecord]);
      },
    };
    const repository = createArangoSparkRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.getBalance('user-1')).resolves.toBe(0);
    await expect(repository.listHistory('user-1', { limit: 10 })).resolves.toMatchObject([{ key: 'transaction-1' }]);
    expect(queries[1]).toContain('SORT item.createdAt DESC, item._key DESC');
    expect(repository).not.toHaveProperty('update');
    expect(repository).not.toHaveProperty('delete');
    expect(Object.isFrozen(repository)).toBe(true);
  });

  test('uses a composite history cursor so equal timestamps are not skipped', async () => {
    let queryText = '', bindings: Record<string, unknown> = {};
    const database: SparkDatabase = { query: async (query, bind) => { queryText = query; bindings = bind ?? {}; return cursor(undefined, []); } };
    const repository = createArangoSparkRepository(database, async (_collections, operation) => operation(database));
    await repository.listHistory('user-1', { limit: 10, beforeCreatedAt: rawRecord.createdAt, beforeKey: 'transaction-2' });
    expect(queryText).toContain('item.createdAt == @beforeCreatedAt && item._key < @beforeKey');
    expect(bindings).toMatchObject({ beforeCreatedAt: rawRecord.createdAt, beforeKey: 'transaction-2', limit: 10 });
  });

  test('advances the durable execution attempt after a linked refund', async () => {
    const charge = { ...rawRecord, _key: 'charge-1', kind: 'tool', deltaMicroSparks: -10, balanceAfterMicroSparks: 90, toolSlug: 'book.create', metadata: { executionIdentity: 'execution-hash', executionAttempt: 1 } };
    const refund = { ...rawRecord, _key: 'refund-1', kind: 'refund', deltaMicroSparks: 10, balanceAfterMicroSparks: 100, idempotencyKey: 'refund:charge-1', metadata: { executionIdentity: 'execution-hash', refundOfTransactionKey: 'charge-1' } };
    const execution = { _key: 'execution-1', userKey: 'user-1', executionIdentity: 'execution-hash', requestHash: input.requestHash, status: 'pending', chargeTransactionKey: 'charge-1', leaseOwner: 'old-owner', leaseExpiresAt: '2026-09-04T10:01:00.000Z' };
    let written: Record<string, unknown> | undefined;
    const transact: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query, bind) => {
      if (query.includes('FOR item IN billingExecutions')) return cursor(execution);
      if (query.includes('DOCUMENT(sparkTransactions')) return cursor(charge);
      if (query.includes('item.kind == "refund"')) return cursor(refund);
      if (query.includes('LET user = DOCUMENT')) {
        written = bind?.record as Record<string, unknown>;
        return cursor({ ...written, balanceAfterMicroSparks: 90 });
      }
      return cursor();
    } });
    const repository = createArangoSparkRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyExecutionCharge!({ ...input, kind: 'tool', deltaMicroSparks: -10, toolSlug: 'book.create' }, 'execution-hash')).resolves.toMatchObject({ status: 'applied', transaction: { idempotencyKey: 'operation-1:a2', metadata: { executionAttempt: 2 } } });
    expect(written).toMatchObject({ idempotencyKey: 'operation-1:a2', metadata: { executionIdentity: 'execution-hash', executionAttempt: 2 } });
  });

  test('blocks a live duplicate, reclaims a stale lease, and completes only for its owner', async () => {
    const charge = { ...rawRecord, _key: 'charge-1', kind: 'tool', deltaMicroSparks: -10, balanceAfterMicroSparks: 90, toolSlug: 'book.create', metadata: { executionIdentity: 'execution-hash', executionAttempt: 1 } };
    const execution = { _key: 'execution-1', userKey: 'user-1', executionIdentity: 'execution-hash', requestHash: input.requestHash, status: 'pending', chargeTransactionKey: 'charge-1', leaseOwner: 'first', leaseExpiresAt: '2026-09-04T10:05:00.000Z' };
    const queries: string[] = [];
    const transact: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => {
      queries.push(query);
      if (query.includes('FOR item IN billingExecutions') && !query.includes('UPDATE item')) return cursor(execution);
      if (query.includes('DOCUMENT(sparkTransactions')) return cursor(charge);
      if (query.includes('item.kind == "refund"')) return cursor();
      if (query.includes('UPDATE item')) return cursor(true);
      return cursor();
    } });
    const repository = createArangoSparkRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyExecutionCharge!({ ...input, kind: 'tool', deltaMicroSparks: -10, toolSlug: 'book.create' }, 'execution-hash', { owner: 'second', now: '2026-09-04T10:02:00.000Z', expiresAt: '2026-09-04T10:07:00.000Z' })).resolves.toMatchObject({ status: 'pending' });
    await expect(repository.applyExecutionCharge!({ ...input, kind: 'tool', deltaMicroSparks: -10, toolSlug: 'book.create' }, 'execution-hash', { owner: 'second', now: '2026-09-04T10:06:00.000Z', expiresAt: '2026-09-04T10:11:00.000Z' })).resolves.toMatchObject({ status: 'applied', claimOwner: 'second', transaction: { key: 'charge-1' } });
    await expect(repository.completeExecution!('user-1', 'execution-hash', 'second', '2026-09-04T10:07:00.000Z')).resolves.toBe(true);
    expect(queries.some((query) => query.includes('recoveryCount'))).toBe(true);
  });

  test('rejects unlinked and excessive refunds', async () => {
    const charge = { ...rawRecord, _key: 'charge-1', kind: 'tool', deltaMicroSparks: -10, balanceAfterMicroSparks: 90, toolSlug: 'book.create' };
    const transact: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => {
      if (query.includes('idempotencyKey')) return cursor();
      if (query.includes('item._key')) return cursor(charge);
      if (query.includes('item.kind == "refund"')) return cursor(undefined, [8]);
      return cursor();
    } });
    const repository = createArangoSparkRepository({ query: async () => cursor() }, transact);
    await expect(repository.apply({ ...input, key: 'refund-2', kind: 'refund', deltaMicroSparks: 3, idempotencyKey: 'refund-2', metadata: { refundOfTransactionKey: 'charge-1' } })).rejects.toMatchObject({ code: 'INVALID_REFUND' });
    await expect(repository.apply({ ...input, key: 'refund-3', kind: 'refund', deltaMicroSparks: 1, idempotencyKey: 'refund-3' })).rejects.toMatchObject({ code: 'INVALID_REFUND' });
  });

  test('requires execution charge refunds to cover the full debit', async () => {
    const charge = { ...rawRecord, _key: 'charge-1', kind: 'tool', deltaMicroSparks: -10, balanceAfterMicroSparks: 90, toolSlug: 'book.create', metadata: { executionIdentity: 'execution-hash', executionAttempt: 1 } };
    const transact: SparkTransactionRunner = async (_collections, operation) => operation({ query: async (query) => {
      if (query.includes('idempotencyKey')) return cursor();
      if (query.includes('item._key')) return cursor(charge);
      return cursor();
    } });
    const repository = createArangoSparkRepository({ query: async () => cursor() }, transact);
    await expect(repository.apply({ ...input, key: 'refund-2', kind: 'refund', deltaMicroSparks: 9, idempotencyKey: 'refund-2', metadata: { refundOfTransactionKey: 'charge-1' } })).rejects.toMatchObject({ code: 'INVALID_REFUND' });
  });
});
