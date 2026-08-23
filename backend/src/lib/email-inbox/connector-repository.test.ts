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
        const document = { ...bindVars.document, _key: previous?._key ?? bindVars.document._key, createdAt: previous?.createdAt ?? bindVars.document.createdAt };
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

  test('fences disconnect against an active connector send lease', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    expect(await createConnectorRepository(database as never).revoke(membershipKey, '2026-08-11T12:00:00.000Z')).toBe(false);
    expect(call?.query).toContain('connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now');
    expect(call?.bindVars).toMatchObject({ key: membershipKey, expectedUpdatedAt: '2026-08-11T12:00:00.000Z' });
  });
});
