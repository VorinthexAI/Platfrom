import { describe, expect, test } from 'bun:test';
import { APP_KEYS } from '@/lib/apps/registry';
import { migrateSparkAccounts } from './arango-migrate';

describe('Spark account migration', () => {
  test('preserves the legacy v1 50-Spark grant without colliding with new-account v2 grants', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    await migrateSparkAccounts({ query: async (query: string, bindVars?: Record<string, unknown>) => {
      queries.push({ query, bindVars });
      if (queries.length === 1) return { all: async () => [{ key: 'user-1', currentScopeKey: 'scope-1' }] } as never;
      return {} as never;
    } } as never);

    expect(queries).toHaveLength(2);
    expect(queries[1]!.query).toContain('idempotencyKey == "account-grant:v1"');
    expect(queries[1]!.query).toContain('deltaMicroSparks: 50000000');
    expect(queries[1]!.query).toContain('requestHash: "account-grant:v1:50-sparks"');
    expect(queries[1]!.query).not.toContain('account-grant:v2');
    expect(queries[1]!.query).toContain('slug: "account.created"');
    expect(queries[1]!.query).toContain('sparkTransactionKey: applied._key');
    expect(queries[1]!.query).toContain('appliedEventKey = existing == null ? @eventKey : existing.eventKey');
    expect(queries[1]!.query.indexOf('DOCUMENT(events, appliedEventKey)')).toBeLessThan(queries[1]!.query.indexOf('INTO sparkTransactions'));
    expect(queries[1]!.query.indexOf('DOCUMENT(events, appliedEventKey)')).toBeLessThan(queries[1]!.query.indexOf('UPDATE user WITH'));
    expect(queries[1]!.bindVars).toMatchObject({ userKey: 'user-1', scopeKey: 'scope-1', appKey: APP_KEYS.CORE });
  });
});
