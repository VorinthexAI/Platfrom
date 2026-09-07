import { describe, expect, test } from 'bun:test';
import { commerceReconciliationRunSchema, createCommerceReconciliationRepository } from './commerce-reconciliation-repository';

describe('commerce reconciliation run repository', () => {
  test('has a strict durable status/completion schema', () => {
    const run = { key: 'a'.repeat(64), windowStart: '2026-01-17T00:00:00.000Z', windowEnd: '2026-01-18T00:00:00.000Z', status: 'pending' as const, createdAt: '2026-01-18T01:00:00.000Z', updatedAt: '2026-01-18T01:00:00.000Z', completedAt: null };
    expect(commerceReconciliationRunSchema.parse(run)).toEqual(run);
    expect(() => commerceReconciliationRunSchema.parse({ ...run, unknown: true })).toThrow();
  });

  test('does not enqueue an already completed latest day', async () => {
    const calls: string[] = [];
    const repository = createCommerceReconciliationRepository({ query: async (query: string) => { calls.push(query); return { next: async () => true, all: async () => [] }; } });
    await expect(repository.prepareLatestMissingDay(new Date('2026-01-18T12:00:00.000Z'))).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
