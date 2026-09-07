import { describe, expect, test } from 'bun:test';
import { migrateSparkAccounts } from './arango-migrate';

describe('Spark account migration', () => {
  test('preserves the legacy v1 50-Spark grant without colliding with new-account v2 grants', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    await migrateSparkAccounts({ query: async (query: string, bindVars?: Record<string, unknown>) => {
      queries.push({ query, bindVars });
      if (queries.length === 1) return { next: async () => ({ key: 'cmrnlzf640001qc7kazsr96k5' }) } as never;
      if (queries.length === 2) return { all: async () => [{ key: 'user-1', currentScopeKey: 'scope-1' }] } as never;
      return {} as never;
    } } as never);

    expect(queries).toHaveLength(3);
    expect(queries[2]!.query).toContain('idempotencyKey == "account-grant:v1"');
    expect(queries[2]!.query).toContain('deltaMicroSparks: 50000000');
    expect(queries[2]!.query).toContain('appScopeKey: @appScopeKey');
    expect(queries[2]!.query).not.toContain('appKey:');
    expect(queries[2]!.bindVars).toMatchObject({ userKey: 'user-1', scopeKey: 'scope-1', appScopeKey: 'cmrnlzf640001qc7kazsr96k5' });
  });
});
