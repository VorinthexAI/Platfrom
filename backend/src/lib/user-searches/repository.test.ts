import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserSearchRepository } from './repository';

test('records and prunes search history to the newest 50 entries atomically', async () => {
  const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
  const database = {
    async query(query: string, bindVars?: Record<string, unknown>) {
      calls.push({ query, bindVars });
      const value = bindVars?.value as Record<string, unknown> | undefined;
      return { async next() { return value; }, async all() { return []; } };
    },
  };
  let transactions = 0;
  const repository = createUserSearchRepository(database as never, async (operation) => {
    transactions += 1;
    return operation(database as never);
  });
  const input = { key: newId(), userKey: newId(), query: 'Tokyo', normalizedQuery: 'tokyo', usageCount: 1, searchedAt: '2026-08-22T12:00:00.000Z' };

  await expect(repository.record(input)).resolves.toEqual(input);
  expect(transactions).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.query).toContain('SORT search.searchedAt DESC, search._key DESC LIMIT 50');
  expect(calls[1]?.query).toContain('search._key NOT IN retained');
  expect(calls[1]?.bindVars).toEqual({ '@collection': 'userSearches', userKey: input.userKey });
});
