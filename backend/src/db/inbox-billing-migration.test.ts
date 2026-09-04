import { describe, expect, test } from 'bun:test';
import { migrateInboxBilling } from './arango-migrate';

describe('connected inbox billing migration', () => {
  test('starts existing active connectors prospectively at one mocked go-live instant', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const goLiveAt = '2026-09-04T12:34:56.789Z';
    await migrateInboxBilling({ query: async (query: string, bindVars?: Record<string, unknown>) => { calls.push({ query, bindVars }); return {} as never; } } as never, goLiveAt);
    expect(calls).toHaveLength(3);
    expect(calls[1]!.query).toContain('startedAt: @goLiveAt');
    expect(calls[0]!.query).not.toContain('connector.createdAt');
    expect(calls[0]!.query).toContain('connector.createdByMembershipKey');
    expect(calls[0]!.query).toContain('connector.status == "active" && connector.syncEnabled == true');
    expect(calls[0]!.query).toContain('scopeMembership != null');
    expect(calls[0]!.query).toContain('connector.billingUserKey == user._key');
    expect(calls[0]!.query).toContain('canonicalPeriod == null');
    expect(calls[0]!.query).toContain('period.startedAt <= @goLiveAt');
    expect(calls[0]!.query).toContain('endedAt: period.startedAt');
    expect(calls[0]!.query).toContain('period.billingVersion == 1');
    expect(calls[0]!.query).toContain('UPDATE period WITH { endedAt: period.startedAt }');
    expect(calls[0]!.bindVars).toEqual({ goLiveAt });
    expect(calls[2]!.query).toContain('billingStatus: "unfunded"');
    expect(calls[2]!.query).toContain('syncEnabled: false');
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source.indexOf("Copied user_organization -> userOrganizations")).toBeLessThan(source.lastIndexOf('await migrateInboxBilling(targetDb)'));
  });

  test('uses the existing valid open period on rerun instead of moving its prospective start', async () => {
    const queries: string[] = [];
    const database = { query: async (query: string) => { queries.push(query); return {} as never; } };
    await migrateInboxBilling(database as never, '2026-09-04T12:00:00.000Z');
    await migrateInboxBilling(database as never, '2026-09-05T12:00:00.000Z');
    expect(queries).toHaveLength(6);
    for (const query of [queries[1]!, queries[4]!]) {
      expect(query).toContain('LET validPeriod = canonicalPeriod == null ? insertedPeriod : canonicalPeriod');
      expect(query).toContain('billingPeriodStartedAt: validPeriod.startedAt');
    }
    expect(queries.every((query) => !query.includes('connector.createdAt'))).toBe(true);
  });
});
