import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createConnectorRepository } from './connector-repository';
import { organizationConnectorSchema } from './connector-schema';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const membershipKey = 'cmrnlzf650002qc7k4p5zem5w';
const previousKeys = process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS;
const previousActiveKey = process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID;

beforeEach(() => {
  process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID = 'test';
  process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS = JSON.stringify({ test: Buffer.alloc(32, 7).toString('base64') });
});

afterEach(() => {
  if (previousKeys === undefined) delete process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS; else process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS = previousKeys;
  if (previousActiveKey === undefined) delete process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID; else process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID = previousActiveKey;
});

describe('organization connector repository', () => {
  test('upserts exact provider accounts and preserves only the reconnected account key', async () => {
    const records = new Map<string, Record<string, unknown>>();
    const upserts: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = {
      collection: () => ({ document: async () => null }),
      query: async (query: string, bindVars: Record<string, any>) => {
        if (!query.includes('IN @@collection')) return { next: async () => undefined, all: async () => [] };
        upserts.push({ query, bindVars });
        const id = bindVars.providerAccountId as string;
        const previous = records.get(id);
        const document = { ...bindVars.document, _key: previous?._key ?? bindVars.document._key, _rev: `revision-${upserts.length}`, createdAt: previous?.createdAt ?? bindVars.document.createdAt };
        records.set(id, document);
        return { next: async () => document, all: async () => [] };
      },
    };
    const repository = createConnectorRepository(database as never);
    const credentials = { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' };
    const accountA = await repository.upsert({ organizationKey: 'org-1', scopeKey, providerAccountId: 'google-a', email: 'a@example.com', scopes: ['email'], createdByMembershipKey: membershipKey, credentials });
    const accountB = await repository.upsert({ organizationKey: 'org-1', scopeKey, providerAccountId: 'google-b', email: 'b@example.com', scopes: ['email'], createdByMembershipKey: membershipKey, credentials });
    const reconnectedA = await repository.upsert({ organizationKey: 'org-1', scopeKey, providerAccountId: 'google-a', email: 'a@example.com', scopes: ['email'], createdByMembershipKey: membershipKey, credentials: { ...credentials, accessToken: 'new-access' } });
    expect(accountA.key).not.toBe(accountB.key);
    expect(reconnectedA.key).toBe(accountA.key);
    expect(upserts).toHaveLength(3);
    expect(upserts.every(({ query }) => query.includes('providerAccountId: @providerAccountId') && query.includes('syncPendingThreadIds: null') && query.includes('watchExpiresAt: null'))).toBe(true);
    expect(upserts.every(({ query }) => !query.includes('sendLeaseToken: null'))).toBe(true);
  });

  test('exact lookup includes revoked connectors for reconnect recovery', async () => {
    const calls: Record<string, unknown>[] = [];
    const database = { collection: () => ({}), query: async (_query: string, bindVars: Record<string, unknown>) => { calls.push(bindVars); return { next: async () => null }; } };
    await createConnectorRepository(database as never).findExact('org-1', scopeKey, 'google-a');
    expect(calls[0]).toMatchObject({ organizationKey: 'org-1', scopeKey, providerAccountId: 'google-a' });
  });

  test('credential refresh is fenced by observed update time and active status', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const connector = organizationConnectorSchema.parse({
      key: membershipKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-a', email: 'a@example.com',
      encryptedCredentials: 'cipher', encryptionKeyId: 'test', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: membershipKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    const updated = await createConnectorRepository(database as never).updateCredentials(connector, { accessToken: 'fresh', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' });
    expect(updated).toBeNull();
    expect(call?.query).toContain('current.updatedAt == @expectedUpdatedAt');
    expect(call?.query).toContain('current.status != "revoked"');
    expect(call?.bindVars).toMatchObject({ key: connector.key, expectedUpdatedAt: now });
  });

  test('atomically fences reconnect rollback on the exact connector and inbox revisions', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const previous = organizationConnectorSchema.parse({
      key: membershipKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-a', email: 'a@example.com',
      encryptedCredentials: 'cipher', encryptionKeyId: 'test', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: membershipKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => true }; } };
    expect(await createConnectorRepository(database as never).rollbackReconnect({ connectorKey: previous.key, connectorRevision: 'connector-rev', previousConnector: previous, inboxRevision: 'inbox-rev', previousInbox: null })).toBe(true);
    expect(call?.query).toContain('connector._rev == @connectorRevision');
    expect(call?.query).toContain('inbox._rev == @inboxRevision');
    expect(call?.query).toContain('REMOVE inbox IN @@inboxes');
    expect(call?.bindVars).toMatchObject({ connectorRevision: 'connector-rev', inboxRevision: 'inbox-rev' });
  });

  test('CAS-fences every callback connector write on its immediately preceding revision', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { collection: () => ({ document: async () => null }), query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => null, all: async () => [] }; } };
    const repository = createConnectorRepository(database as never);
    await expect(repository.upsert({ organizationKey: 'org-1', scopeKey, providerAccountId: 'google-cas', email: 'cas@example.com', scopes: ['email'], createdByMembershipKey: membershipKey, credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }, expectedRevision: 'snapshot-revision' })).rejects.toThrow('changed during OAuth');
    expect(await repository.setSyncState(membershipKey, 'idle', { expectedRevision: 'upsert-revision' })).toBeNull();
    expect(await repository.activateInitialization(membershipKey, 'fingerprint', 'sync-revision')).toBeNull();
    expect(await repository.updateWatch(membershipKey, { historyId: 'history', expiration: String(Date.now() + 60_000) }, 'active-revision')).toBeNull();
    const callbackCalls = calls.filter(({ bindVars }) => bindVars.expectedRevision !== undefined);
    expect(callbackCalls[0]?.query).toContain('existing._rev == @expectedRevision');
    expect(callbackCalls[0]?.bindVars).toMatchObject({ fenceRevision: true, expectedRevision: 'snapshot-revision' });
    expect(callbackCalls[1]?.query).toContain('connector._rev == @expectedRevision');
    expect(callbackCalls[1]?.bindVars.expectedRevision).toBe('upsert-revision');
    expect(callbackCalls[2]?.bindVars.expectedRevision).toBe('sync-revision');
    expect(callbackCalls[3]?.bindVars.expectedRevision).toBe('active-revision');
  });

  test('fences disconnect against active connector sync and send leases', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    expect(await createConnectorRepository(database as never).revoke(membershipKey, '2026-08-11T12:00:00.000Z')).toBe(false);
    expect(call?.query).toContain('connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now');
    expect(call?.query).toContain('connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now');
    expect(call?.bindVars).toMatchObject({ key: membershipKey, expectedUpdatedAt: '2026-08-11T12:00:00.000Z' });
  });

  test('makes connector sync and send claims mutually exclusive', async () => {
    const calls: string[] = [];
    const database = { collection: () => ({}), query: async (query: string) => { calls.push(query); return { next: async () => null }; } };
    const repository = createConnectorRepository(database as never);
    await repository.claimSync(membershipKey, 'sync-token', '2026-08-11T13:00:00.000Z');
    await repository.claimSend(membershipKey, 'send-token', '2026-08-11T13:00:00.000Z');
    expect(calls[0]).toContain('connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now');
    expect(calls[1]).toContain('connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now');
  });

  test('atomically reactivates an errored connector when its sync lease starts work', async () => {
    let call: { query: string; bindVars: Record<string, any> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, any>) => { call = { query, bindVars }; return { next: async () => ({ _rev: 'next' }) }; } };
    expect(await createConnectorRepository(database as never).setSyncState(membershipKey, 'syncing', { leaseToken: '11111111-1111-4111-8111-111111111111' })).toBe('next');
    expect(call?.query).toContain('connector.syncLeaseToken == @leaseToken');
    expect(call?.bindVars.update).toMatchObject({ status: 'active', syncStatus: 'syncing', lastError: null });
  });

  test('rejects renewal after lease expiry or connector disablement while allowing error recovery', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => null }; } };
    const repository = createConnectorRepository(database as never);
    expect(await repository.renewSync(membershipKey, '11111111-1111-4111-8111-111111111111', '2026-08-11T13:00:00.000Z')).toBe(false);
    expect(await repository.renewSend(membershipKey, '22222222-2222-4222-8222-222222222222', '2026-08-11T13:00:00.000Z')).toBe(false);
    expect(calls).toHaveLength(2);
    for (const { query, bindVars } of calls) {
      expect(query).toContain('connector.syncEnabled != false');
      expect(query).toContain('LeaseExpiresAt > @now');
      expect(bindVars.now).toBeString();
    }
    expect(calls[0]!.query).toContain('connector.status != "revoked"');
    expect(calls[0]!.query).not.toContain('connector.status == "active"');
    expect(calls[1]!.query).toContain('connector.status == "active"');
    expect(calls[0]!.query).toContain('connector.syncLeaseToken == @token');
    expect(calls[1]!.query).toContain('connector.sendLeaseToken == @token');
  });

  test('fences watch persistence against disconnects and connector revisions', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    await createConnectorRepository(database as never).updateWatch(membershipKey, { historyId: '1', expiration: String(Date.now() + 60_000) }, undefined, '2026-08-11T12:00:00.000Z');
    expect(call?.query).toContain('connector.status != "revoked"');
    expect(call?.query).toContain('connector.syncEnabled != false');
    expect(call?.query).toContain('connector.updatedAt == @expectedUpdatedAt');
  });
});
