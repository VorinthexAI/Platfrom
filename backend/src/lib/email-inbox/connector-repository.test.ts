import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorPublic, createConnectorRepository } from './connector-repository';
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
    expect(upserts.every(({ query }) => query.includes('providerAccountId: @providerAccountId') && query.includes('initialSyncCompleted: false') && query.includes('pendingNotificationHistoryId: null') && query.includes('syncPendingThreadIds: null') && query.includes('watchExpiresAt: null'))).toBe(true);
    expect(accountA.initialSyncCompleted).toBe(false);
    expect(upserts.every(({ query }) => !query.includes('sendLeaseToken: null'))).toBe(true);
  });

  test('requires initial synchronization completion in the public connector projection', () => {
    const connector = organizationConnectorSchema.parse({ key: membershipKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-public', email: 'public@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'test', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: membershipKey, status: 'active', initialSyncCompleted: true, createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z' });
    expect(connectorPublic(connector)).toMatchObject({ initialSyncCompleted: true });
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
    expect(call?.bindVars).toMatchObject({ '@inboxes': 'emailInboxes' });
    expect(call?.query).not.toContain('managedPurpose');
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
    expect(call?.query).toContain('period.endedAt == null');
    expect(call?.query).toContain('endedAt: @now');
    expect(call?.bindVars).toMatchObject({ key: membershipKey, expectedUpdatedAt: '2026-08-11T12:00:00.000Z' });
  });

  test('starts each new or recovered billing period atomically while preserving immutable attribution', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => null, all: async () => [] }; } };
    const repository = createConnectorRepository(database as never);
    await expect(repository.upsert({ organizationKey: 'org-1', scopeKey, providerAccountId: 'billing', email: 'billing@example.com', scopes: ['email'], createdByMembershipKey: membershipKey, billingUserKey: membershipKey, credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: '2027-08-11T12:00:00.000Z' }, expectedRevision: null })).rejects.toThrow('changed during OAuth');
    expect(calls[0]!.query).toContain('OLD.billingUserKey == null ? @billingUserKey : OLD.billingUserKey');
    expect(calls[0]!.query).toContain('existing.billingStatus IN ["unfunded", "recovery-pending"]');
    expect(calls[0]!.query).toContain('syncEnabled: billingSuspended ? false : @document.syncEnabled');
    expect(calls[0]!.query).toContain('existing.billingStatus == "disabled"');
    expect(calls[0]!.query).toContain('INTO inboxBillingPeriods');
    expect(calls[0]!.bindVars.billingUserKey).toBe(membershipKey);
    expect(calls[0]!.bindVars.document).toMatchObject({ billingUserKey: membershipKey, billingStatus: 'funded' });
  });

  test('activates a newly initialized connector and its first billing period in one write query', async () => {
    let query = '';
    const database = { collection: () => ({}), query: async (value: string) => { query = value; return { next: async () => null }; } };
    await createConnectorRepository(database as never).activateInitialization(membershipKey, 'a'.repeat(64));
    expect(query).toContain('connector.billingUserKey != null');
    expect(query).toContain('INTO inboxBillingPeriods');
    expect(query).toContain('billingStatus: "funded"');
  });

  test('removes only the newly opened reconnect period when callback rollback restores the prior connector', async () => {
    const previous = organizationConnectorSchema.parse({ key: membershipKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'rollback-billing', email: 'billing@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'test', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: membershipKey, billingUserKey: membershipKey, billingStatus: 'funded', billingPeriodStartedAt: '2026-08-10T12:00:00.000Z', status: 'active', createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z' });
    let call: { query: string; bindVars: Record<string, any> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, any>) => { call = { query, bindVars }; return { next: async () => true }; } };
    await createConnectorRepository(database as never).rollbackReconnect({ connectorKey: previous.key, connectorRevision: 'revision', previousConnector: previous, previousInbox: null });
    expect(call?.query).toContain('period.startedAt == connector.billingPeriodStartedAt');
    expect(call?.query).toContain('period.startedAt != @previousBillingPeriodStartedAt');
    expect(call?.bindVars.previousBillingPeriodStartedAt).toBe(previous.billingPeriodStartedAt);
  });

  test('blocks new connector work while provider revocation is pending', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    expect(await createConnectorRepository(database as never).claimDisconnect(membershipKey, '2026-08-11T12:00:00.000Z')).toBeNull();
    expect(call?.query).toContain('syncEnabled: false');
    expect(call?.query).toContain('status: "error"');
    expect(call?.query).toContain('period.endedAt == null');
    expect(call?.query).toContain('billingStatus: "disabled"');
    expect(call?.query).toContain('connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now');
    expect(call?.query).toContain('connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now');
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

  test('atomically completes initial sync only with a final idle state and no continuation', async () => {
    let call: { bindVars: Record<string, any> } | undefined;
    const database = { collection: () => ({}), query: async (_query: string, bindVars: Record<string, any>) => { call = { bindVars }; return { next: async () => ({ _rev: 'complete' }) }; } };
    const repository = createConnectorRepository(database as never);
    await expect(repository.setSyncState(membershipKey, 'syncing', { completeInitialSync: true })).rejects.toThrow('final idle state');
    await expect(repository.setSyncState(membershipKey, 'idle', { pendingHistoryId: 'pending', completeInitialSync: true })).rejects.toThrow('final idle state');
    await expect(repository.setSyncState(membershipKey, 'idle', { pendingSubscriptionMessages: [{ id: 'message', threadId: 'thread' }], completeInitialSync: true })).rejects.toThrow('final idle state');
    expect(await repository.setSyncState(membershipKey, 'idle', { pendingHistoryId: null, pendingThreadIds: null, completeInitialSync: true, leaseToken: '11111111-1111-4111-8111-111111111111' })).toBe('complete');
    expect(call?.bindVars.update).toMatchObject({ syncStatus: 'idle', initialSyncCompleted: true, syncPendingHistoryId: null, syncPendingThreadIds: null, syncPendingSubscriptionMessages: undefined });
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

  test('persists notification high-water marks and exposes durable recovery targets', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => true, all: async () => [{ organizationKey: 'org-1', scopeKey, connectorKey: membershipKey, initialSyncCompleted: true, pendingNotificationHistoryId: '123' }] }; } };
    const repository = createConnectorRepository(database as never);
    expect(await repository.markNotificationPending(membershipKey, '123')).toBe(true);
    expect(await repository.clearPendingNotification(membershipKey, '123')).toBe(true);
    expect(await repository.listSyncRecoveryTargets()).toEqual([{ organizationKey: 'org-1', scopeKey, connectorKey: membershipKey, initialSyncCompleted: true, pendingNotificationHistoryId: '123' }]);
    expect(calls[0]!.query).toContain('pendingNotificationHistoryId');
    expect(calls[0]!.query).toContain('LENGTH(@historyId)');
    expect(calls[1]!.query).toContain('connector.pendingNotificationHistoryId == @historyId');
    expect(calls[1]!.query).toContain('LENGTH(NOT_NULL(connector.syncPendingThreadIds, [])) == 0');
    expect(calls[1]!.query).toContain('connector.historyId >= @historyId');
    expect(calls[2]!.query).toContain('connector.initialSyncCompleted != true');
  });

  test('renews watch metadata without changing the persisted History or pending continuation cursor', async () => {
    const record: Record<string, any> = {
      ...organizationConnectorSchema.parse({
        key: membershipKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-watch', email: 'watch@example.com',
        encryptedCredentials: 'cipher', encryptionKeyId: 'test', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: membershipKey,
        status: 'active', historyId: 'history-committed', syncPendingHistoryId: 'history-pending', syncPendingThreadIds: ['thread-a', 'thread-b'], createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
      }),
      _key: membershipKey,
      _rev: 'before-watch',
    };
    const database = {
      collection: () => ({}),
      query: async (_query: string, bindVars: Record<string, any>) => {
        record.watchRegisteredAt = bindVars.updatedAt;
        record.watchExpiresAt = bindVars.watchExpiresAt;
        record.updatedAt = bindVars.updatedAt;
        record._rev = 'after-watch';
        return { next: async () => ({ ...record }) };
      },
    };
    expect(await createConnectorRepository(database as never).updateWatch(membershipKey, { historyId: 'watch-response-history-must-not-win', expiration: String(Date.parse('2026-08-12T12:00:00.000Z')) }, 'before-watch', '2026-08-11T12:00:00.000Z')).toBe('after-watch');
    expect(record).toMatchObject({ historyId: 'history-committed', syncPendingHistoryId: 'history-pending', syncPendingThreadIds: ['thread-a', 'thread-b'], watchExpiresAt: '2026-08-12T12:00:00.000Z' });
  });
});
