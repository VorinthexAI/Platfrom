import { describe, expect, test } from 'bun:test';
import { sparkTransactionSchema, type SparkTransaction } from './contracts';
import { SparkRepositoryError, type ApplySparkTransaction, type SparkRepository } from './repository';
import { createSparkService } from './service';

function createMemoryRepository(initialBalance = 0) {
  let balance = initialBalance;
  const transactions: SparkTransaction[] = [];
  const repository: SparkRepository = {
    async apply(input: ApplySparkTransaction) {
      const existing = transactions.find((item) => item.userKey === input.userKey && item.idempotencyKey === input.idempotencyKey);
      if (existing) return existing.requestHash === input.requestHash
        ? { status: 'replayed', transaction: existing }
        : { status: 'conflict', transaction: existing };
      if (balance + input.deltaMicroSparks < 0) throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'Spark balance is insufficient for this transaction.');
      balance += input.deltaMicroSparks;
      const transaction = sparkTransactionSchema.parse({ ...input, balanceAfterMicroSparks: balance });
      transactions.push(transaction);
      return { status: 'applied', transaction };
    },
    async getBalance() { return balance; },
    async listHistory(_userKey, input = { limit: 50 }) { return transactions.slice(-input.limit).reverse(); },
  };
  return { repository, transactions, get balance() { return balance; } };
}

const identity = { idempotencyKey: 'operation-1', requestHash: '0123456789abcdef' };

describe('Spark service', () => {
  test('does not expose a second account-grant path beside account initialization', () => {
    const service = createSparkService({ repository: createMemoryRepository().repository });
    expect(service).not.toHaveProperty('grantAccount');
  });

  test('records debit, refund, signed adjustment, and idempotency conflict without allowing debt', async () => {
    const memory = createMemoryRepository(100);
    const service = createSparkService({ repository: memory.repository, createKey: () => `transaction-${memory.transactions.length}`, now: () => new Date('2026-09-04T10:00:00.000Z') });
    await expect(service.charge('user-1', { ...identity, kind: 'tool', toolSlug: 'document.create', microSparks: 80 })).resolves.toMatchObject({ transaction: { deltaMicroSparks: -80, balanceAfterMicroSparks: 20 } });
    await expect(service.charge('user-1', { ...identity, idempotencyKey: 'charge-2', kind: 'tool', toolSlug: 'document.create', microSparks: 21 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(service.adjust('user-1', { ...identity, idempotencyKey: 'adjust-1', deltaMicroSparks: -21 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(service.refund('user-1', { ...identity, idempotencyKey: 'refund-1', microSparks: 20, chargeTransactionKey: 'transaction-0' })).resolves.toMatchObject({ transaction: { deltaMicroSparks: 20, balanceAfterMicroSparks: 40, metadata: { refundOfTransactionKey: 'transaction-0' } } });
    await expect(service.refund('user-1', { ...identity, requestHash: 'fedcba9876543210', microSparks: 10, chargeTransactionKey: 'transaction-0' })).resolves.toMatchObject({ status: 'conflict' });
    expect(memory.balance).toBe(40);
  });

  test('keeps a linked refund independent from the charge event key', async () => {
    const memory = createMemoryRepository(100);
    const service = createSparkService({ repository: memory.repository, createKey: () => `transaction-${memory.transactions.length}`, now: () => new Date('2026-09-04T10:00:00.000Z') });
    const charge = await service.charge('user-1', { ...identity, kind: 'tool', toolSlug: 'document.create', microSparks: 20, eventKey: 'event-1' });
    const refund = await service.refund('user-1', { ...identity, idempotencyKey: 'refund-1', microSparks: 20, chargeTransactionKey: charge.transaction.key });
    expect(charge.transaction.eventKey).toBe('event-1');
    expect(refund.transaction.eventKey).toBeUndefined();
    expect(refund.transaction.metadata).toEqual({ refundOfTransactionKey: charge.transaction.key });
    expect(new Set(memory.transactions.flatMap(({ eventKey }) => eventKey ? [eventKey] : [])).size).toBe(1);
  });

  test('does not charge an unpriced invocation or zero storage usage', async () => {
    const memory = createMemoryRepository();
    const service = createSparkService({ repository: memory.repository });
    await expect(service.chargeInvocation('user-1', { ...identity, toolSlug: 'document.create', actionSlug: 'text.generate' })).resolves.toBeNull();
    await expect(service.chargeStorage('user-1', { ...identity, byteHours: 0 })).resolves.toBeNull();
    expect(memory.transactions).toEqual([]);
  });

  test('records recurring service debits independently from storage', async () => {
    const memory = createMemoryRepository(200_000);
    const service = createSparkService({ repository: memory.repository });
    await service.charge('user-1', { ...identity, kind: 'recurring-service', microSparks: 136_986 });
    expect(memory.transactions[0]).toMatchObject({ kind: 'recurring-service', deltaMicroSparks: -136_986 });
  });

  test('validates invalid amounts and propagates persistence failures', async () => {
    const failure = new Error('transaction rolled back');
    const repository: SparkRepository = {
      apply: async () => { throw failure; },
      getBalance: async () => { throw failure; },
      listHistory: async () => { throw failure; },
    };
    const service = createSparkService({ repository });
    expect(() => service.charge('user-1', { ...identity, kind: 'action', microSparks: 0 })).toThrow();
    expect(() => service.adjust('user-1', { ...identity, deltaMicroSparks: Number.NaN })).toThrow();
    await expect(service.refund('user-1', { ...identity, microSparks: 1, chargeTransactionKey: 'charge-1' })).rejects.toBe(failure);
    await expect(service.getBalance('user-1')).rejects.toBe(failure);
    await expect(service.listHistory('user-1')).rejects.toBe(failure);
  });

  test('reports a missing summary account with the canonical repository error', async () => {
    const repository: SparkRepository = {
      apply: async () => { throw new Error('unused'); },
      getBalance: async () => null,
      listHistory: async () => [],
    };
    const service = createSparkService({ repository });
    await expect(service.getSummary('missing-user')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  test('keeps balances and idempotency isolated between users', async () => {
    const balances = new Map([['user-1', 100], ['user-2', 50]]);
    const transactions = new Map<string, SparkTransaction>();
    const repository: SparkRepository = {
      async apply(input) {
        const identity = `${input.userKey}:${input.idempotencyKey}`;
        const existing = transactions.get(identity);
        if (existing) return existing.requestHash === input.requestHash ? { status: 'replayed', transaction: existing } : { status: 'conflict', transaction: existing };
        const balance = balances.get(input.userKey) ?? 0;
        if (balance + input.deltaMicroSparks < 0) throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'insufficient');
        balances.set(input.userKey, balance + input.deltaMicroSparks);
        const transaction = sparkTransactionSchema.parse({ ...input, balanceAfterMicroSparks: balances.get(input.userKey) });
        transactions.set(identity, transaction);
        return { status: 'applied', transaction };
      },
      async getBalance(userKey) { return balances.get(userKey) ?? null; },
      async listHistory() { return []; },
    };
    const service = createSparkService({ repository, createKey: () => `transaction-${transactions.size}` });
    await service.charge('user-1', { ...identity, kind: 'tool', toolSlug: 'document.create', microSparks: 80 });
    await expect(service.charge('user-2', { ...identity, kind: 'tool', toolSlug: 'document.create', microSparks: 80 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await service.getBalance('user-1')).toBe(20);
    expect(await service.getBalance('user-2')).toBe(50);
  });
});
