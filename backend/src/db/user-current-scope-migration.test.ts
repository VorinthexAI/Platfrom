import { describe, expect, test } from 'bun:test';
import { migrateUserCurrentScopes } from './arango-migrate';

describe('user current-scope migration', () => {
  test('provisions a personal Main scope and stores a non-null current scope for every user', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    await migrateUserCurrentScopes({
      query: async (query: string, bindVars?: Record<string, unknown>) => {
        queries.push({ query, bindVars });
        if (queries.length === 1) {
          return { all: async () => [{ key: 'user-1', name: 'Ada', email: 'ada@example.com' }] } as never;
        }
        return {} as never;
      },
    } as never);

    expect(queries).toHaveLength(2);
    expect(queries[1]!.query).toContain('UPSERT { personalOwnerUserId: @userKey }');
    expect(queries[1]!.query).toContain('UPSERT { organizationKey: organization._key, slug: "main" }');
    expect(queries[1]!.query).toContain('currentScopeKey: selectedScope == null ? scope._key : selectedScope._key');
    expect(queries[1]!.bindVars).toMatchObject({ userKey: 'user-1', organizationName: "Ada's Organization" });
  });
});
