import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { organizationConnectorSchema } from './connector-schema';
import { createInboxRepository } from './inbox-repository';

const now = '2026-08-23T00:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);

describe('inbox repository', () => {
  test('ensures one row by connectorKey and preserves metadata unless reconnect explicitly overwrites it', async () => {
    const connector = organizationConnectorSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey: newId(), provider: 'gmail', providerAccountId: 'provider', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: newId(), status: 'active', createdAt: now, updatedAt: now });
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); if (query.includes('UPSERT { scopeKey: @scopeKey, purpose: @purpose }')) return {}; return { next: async () => ({ _key: bindVars.key, _rev: 'inbox-revision', organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, connectorKey: connector.key, name: bindVars.name, isFavorite: false, embedding, createdAt: bindVars.updatedAt, updatedAt: bindVars.updatedAt }) }; }, collection: () => ({}) };
    await createInboxRepository(database as never).ensure(connector, { name: 'Work' }, embedding, false);
    const inboxCall = calls.find(({ query }) => query.includes('managedPurpose: "mail-inbox"'))!;
    expect(inboxCall.query).toContain('@overwrite && OLD.scopeKey == @scopeKey');
    expect(inboxCall.bindVars).toMatchObject({ connectorKey: connector.key, overwrite: false, name: 'Work' });
    expect(inboxCall.bindVars.key).toBeDefined();
  });

  test('authorizes cover images in the same scope inside the update query', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => undefined }; }, collection: () => ({}) };
    const coverImageKey = newId();
    await createInboxRepository(database as never).update('organization', newId(), newId(), now, { coverImageKey });
    expect(calls[0]!.query).toContain('cover.scopeKey == @scopeKey');
    expect(calls[0]!.query).not.toContain('cover.mutationPolicy');
    expect(calls[0]!.query).toContain('inbox.updatedAt == @expectedUpdatedAt');
    expect(calls[0]!.query).toContain('inbox.managedPurpose == "mail-inbox"');
    expect(calls[0]!.bindVars).toMatchObject({ setCover: true, coverImageKey, expectedUpdatedAt: now });
  });

  test('fences reconnect metadata overwrite on the inbox revision captured before OAuth upsert', async () => {
    const connector = organizationConnectorSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey: newId(), provider: 'gmail', providerAccountId: 'provider', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: newId(), status: 'active', createdAt: now, updatedAt: now });
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { if (query.includes('UPSERT { scopeKey: @scopeKey, purpose: @purpose }')) return {}; call = { query, bindVars }; return { next: async () => null }; }, collection: () => ({}) };
    expect(await createInboxRepository(database as never).ensure(connector, { name: 'Replacement' }, embedding, true, 'inbox-before-oauth')).toBeNull();
    expect(call?.query).toContain('existing._rev == @expectedRevision');
    expect(call?.query).toContain('IN folders');
    expect(call?.bindVars).toMatchObject({ overwrite: true, expectedRevision: 'inbox-before-oauth' });
  });

  test('semantic search applies organization, scope, connector, and score boundaries before ranking', async () => {
    const scopeKey = newId();
    const connectorKey = newId();
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { all: async () => [] }; }, collection: () => ({}) };
    expect(await createInboxRepository(database as never).search('organization', scopeKey, [connectorKey], embedding, '  Leadership  ', 0.55, 10)).toEqual([]);
    expect(call?.query).toContain('connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey');
    expect(call?.query).toContain('connector._key IN @connectorKeys');
    expect(call?.query).toContain('folder.managedPurpose == "mail-inbox"');
    expect(call?.query).toContain('COSINE_SIMILARITY(folder.embedding, @embedding)');
    expect(call?.query).toContain('SORT direct DESC, score DESC');
    expect(call?.bindVars).toMatchObject({ organizationKey: 'organization', scopeKey, connectorKeys: [connectorKey], query: 'leadership', minimumScore: 0.55, limit: 10 });
  });
});
