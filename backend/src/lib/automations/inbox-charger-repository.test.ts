import { describe, expect, test } from 'bun:test';
import { HOUR_MS } from './storage-charger';
import { createInboxChargingRepository, inboxBillingPeriodId, inboxBillingPeriodSchema, inboxChargingHourSchema, inboxConnectorHourId } from './inbox-charger-repository';

describe('connected inbox charging persistence', () => {
  test('uses deterministic IDs and strict durable schemas', () => {
    const start = '2026-09-04T11:00:00.000Z';
    expect(inboxConnectorHourId('connector', start)).toMatch(/^[a-f0-9]{64}$/);
    expect(inboxConnectorHourId('connector', start)).toBe(inboxConnectorHourId('connector', start));
    expect(inboxBillingPeriodId('connector', start)).not.toBe(inboxConnectorHourId('connector', start));
    expect(() => inboxBillingPeriodSchema.parse({ key: 'x', connectorKey: 'c', userKey: 'u', organizationKey: 'o', scopeKey: 's', startedAt: start, extra: true })).toThrow();
    expect(() => inboxChargingHourSchema.parse({ key: 'x', kind: 'hour', hourStart: start, hourEnd: new Date(Date.parse(start) + HOUR_MS).toISOString(), status: 'completed', extra: true })).toThrow();
  });

  test('computes half-open connection-period overlap and excludes missing connectors and users', async () => {
    let call: { query: string; bindVars?: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars?: Record<string, unknown>) => { call = { query, bindVars }; return { all: async () => [{ connectorKey: 'connector', userKey: 'user', scopeKey: 'scope', activeMilliseconds: '3599999', payerAuthorized: true, recoveryPending: false }] }; } };
    const repository = createInboxChargingRepository(database as never, async (operation) => operation(database as never));
    expect(await repository.listConnectorUsage({ start: '2026-09-04T11:00:00.000Z', end: '2026-09-04T12:00:00.000Z' })).toEqual([{ connectorKey: 'connector', userKey: 'user', scopeKey: 'scope', activeMilliseconds: '3599999', payerAuthorized: true, recoveryPending: false }]);
    expect(call?.query).toContain('period.startedAt < @end');
    expect(call?.query).toContain('period.endedAt > @start');
    expect(call?.query).toContain('connector != null');
    expect(call?.query).toContain('membership != null && scopeMembership != null');
    expect(call?.query).toContain('connector.billingUserKey == period.userKey');
  });

  test('persists immutable attribution and recovery state on connector-hour records', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      calls.push({ query, bindVars });
      return { all: async () => [] };
    } };
    const repository = createInboxChargingRepository(database as never, async (operation) => operation(database as never));
    const prepared = await repository.prepareConnectorHour({ connectorKey: 'connector', userKey: 'user', scopeKey: 'immutable-scope', activeMilliseconds: String(HOUR_MS), payerAuthorized: true, recoveryPending: true, start: '2026-09-04T11:00:00.000Z', end: '2026-09-04T12:00:00.000Z' });
    expect(prepared).toMatchObject({ scopeKey: 'immutable-scope', payerAuthorized: true, recoveryPending: true });
    expect(calls.find(({ query }) => query.includes('INSERT @document'))?.bindVars?.document).toMatchObject({ scopeKey: 'immutable-scope', payerAuthorized: true, recoveryPending: true });
  });

  test('suspension closes the period, clears leases, and preserves the pre-failure remainder', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => { calls.push({ query, bindVars }); return { all: async () => [] }; } };
    const repository = createInboxChargingRepository(database as never, async (operation) => operation(database as never));
    await repository.markConnectorHourUnfunded({ connectorKey: 'connector', userKey: 'user', scopeKey: 'scope', activeMilliseconds: String(HOUR_MS), payerAuthorized: true, recoveryPending: false, hourStart: '2026-09-04T11:00:00.000Z', hourEnd: '2026-09-04T12:00:00.000Z', previousRemainder: '7', amountMicroSparks: '136986', remainder: '8', idempotencyKey: 'a'.repeat(64), status: 'pending' }, '2026-09-04T12:00:01.000Z');
    expect(calls.some(({ query, bindVars }) => query.includes('INSERT @meter') && bindVars?.meter?.remainder === '7')).toBe(true);
    expect(calls.some(({ query }) => query.includes('endedAt: @hourEnd'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('billingStatus: "unfunded"') && query.includes('syncLeaseToken: null'))).toBe(true);
  });

  test('blocks out-of-order downtime hours until the prior deterministic hour completes', async () => {
    const start = '2026-09-04T11:00:00.000Z';
    let reads = 0;
    const database = { query: async () => ({ all: async () => { reads += 1; return reads === 1 ? ['2026-09-04T09:30:00.000Z'] : []; } }) };
    const repository = createInboxChargingRepository(database as never, async (operation) => operation(database as never));
    await expect(repository.assertHourReady({ start, end: new Date(Date.parse(start) + HOUR_MS).toISOString() })).rejects.toThrow('prior inbox charging hour');
  });

  test('uses a bounded high-water recovery window rather than scanning lifetime hour records', async () => {
    let call = 0;
    const database = { query: async () => ({ all: async () => { call += 1; return call === 1 ? ['2026-08-01T00:00:00.000Z'] : ['2026-09-01T00:00:00.000Z']; } }) };
    const hours = await createInboxChargingRepository(database as never, async (operation) => operation(database as never)).listMissedClosedHours(new Date('2026-09-04T12:00:00.000Z'));
    expect(hours).toHaveLength(24);
    expect(hours[0]?.start).toBe('2026-09-01T00:00:00.000Z');
  });

  test('pages authorized unfunded connectors and computes their exact next-hour amount from carry', async () => {
    const database = { query: async () => ({ all: async () => [{ connectorKey: 'a', userKey: 'user', remainder: '2000000000' }] }) };
    const page = await createInboxChargingRepository(database as never, async (operation) => operation(database as never)).listUnfundedConnectors(null, 1);
    expect(page).toEqual({ items: [{ connectorKey: 'a', userKey: 'user', remainder: '2000000000', nextHourMicroSparks: '136987' }], nextAfterKey: 'a' });
  });
});
