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
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => ({ ...(bindVars.document as object), _key: (bindVars.document as { _key: string })._key, _rev: 'inbox-revision' }) }; }, collection: () => ({}) };
    await createInboxRepository(database as never).ensure(connector, { name: 'Work' }, embedding, false);
    expect(calls[0]!.query).toContain('UPSERT { connectorKey: @connectorKey }');
    expect(calls[0]!.query).toContain('@overwrite ? MERGE');
    expect(calls[0]!.bindVars).toMatchObject({ connectorKey: connector.key, overwrite: false, name: 'Work' });
  });

  test('authorizes cover images in the same scope inside the update query', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => undefined }; }, collection: () => ({}) };
    const coverImageKey = newId();
    await createInboxRepository(database as never).update('organization', newId(), newId(), now, { coverImageKey });
    expect(calls[0]!.query).toContain('cover.scopeKey == @scopeKey');
    expect(calls[0]!.query).not.toContain('cover.mutationPolicy');
    expect(calls[0]!.query).toContain('inbox.updatedAt == @expectedUpdatedAt');
    expect(calls[0]!.bindVars).toMatchObject({ setCover: true, coverImageKey, expectedUpdatedAt: now });
  });

  test('fences reconnect metadata overwrite on the inbox revision captured before OAuth upsert', async () => {
    const connector = organizationConnectorSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey: newId(), provider: 'gmail', providerAccountId: 'provider', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: newId(), status: 'active', createdAt: now, updatedAt: now });
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; }, collection: () => ({}) };
    expect(await createInboxRepository(database as never).ensure(connector, { name: 'Replacement' }, embedding, true, 'inbox-before-oauth')).toBeNull();
    expect(call?.query).toContain('existing._rev == @expectedRevision');
    expect(call?.bindVars).toMatchObject({ overwrite: true, expectedRevision: 'inbox-before-oauth' });
  });
});
