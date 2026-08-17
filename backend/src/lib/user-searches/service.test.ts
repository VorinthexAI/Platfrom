import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserSearchService, normalizeUserSearchQuery } from './service';
import type { UserSearch, UserSearchRepository } from './repository';

describe('global user search history', () => {
  test('normalizes, aggregates, lists, and deletes only by user and query', async () => {
    const rows = new Map<string, UserSearch>();
    const repository: UserSearchRepository = {
      async record(value) { const identity = `${value.userKey}:${value.normalizedQuery}`; const old = rows.get(identity); const next = old ? { ...old, query: value.query, searchedAt: value.searchedAt, usageCount: old.usageCount + 1 } : value; rows.set(identity, next); return next; },
      async list(userKey, limit) { return [...rows.values()].filter((row) => row.userKey === userKey).sort((a, b) => b.searchedAt.localeCompare(a.searchedAt)).slice(0, limit); },
      async remove(userKey, normalizedQuery) { return rows.delete(`${userKey}:${normalizedQuery}`); },
    };
    const userKey = newId();
    let searchedAt = '2026-08-17T10:00:00.000Z';
    const service = createUserSearchService({ repository, now: () => searchedAt });
    await service.record(userKey, '  Launch   ROADMAP  ');
    searchedAt = '2026-08-17T11:00:00.000Z';
    await service.record(userKey, 'launch roadmap');
    expect(await service.list(userKey)).toEqual([{ query: 'launch roadmap', normalizedQuery: 'launch roadmap', searchedAt, usageCount: 2 }]);
    expect(await service.list(newId())).toEqual([]);
    expect(await service.remove(userKey, ' LAUNCH roadmap ')).toEqual({ normalizedQuery: 'launch roadmap', deleted: true });
  });

  test('uses one product-neutral normalization rule', () => {
    expect(normalizeUserSearchQuery('  Ａ  B  ')).toBe('a b');
  });
});
