import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { organizationConnectorSchema } from './connector-schema';
import { createInboxRepository } from './inbox-repository';

const now = '2026-08-25T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);

function connector() {
  return organizationConnectorSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey: newId(), provider: 'gmail', providerAccountId: 'provider', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: newId(), status: 'active', createdAt: now, updatedAt: now });
}

describe('dedicated inbox repository', () => {
  test('ensures one emailInboxes row by connector and preserves user metadata on overwrite', async () => {
    const source = connector();
    let call: { query: string; bindVars: Record<string, any> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, any>) => {
      call = { query, bindVars };
      return { next: async () => ({ ...bindVars.value, _rev: 'inbox-revision' }) };
    } };
    const value = await createInboxRepository(database as never).ensure(source, { name: 'Work' }, embedding, true);
    expect(value).toMatchObject({ connectorKey: source.key, name: 'Work', isFavorite: false });
    expect(call?.query).toContain('IN @@inboxes');
    expect(call?.query).toContain('createdAt: OLD.createdAt');
    expect(call?.query).toContain('isFavorite: OLD.isFavorite');
    expect(call?.bindVars).toMatchObject({ '@inboxes': 'emailInboxes' });
  });

  test('authorizes cover images and optimistic updates without managed folder markers', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    await createInboxRepository(database as never).update('organization', newId(), newId(), now, { coverImageKey: newId() });
    expect(call?.query).toContain('cover.scopeKey == @scopeKey');
    expect(call?.query).toContain('inbox.updatedAt == @expectedUpdatedAt');
    expect(call?.query).toContain('UPDATE inbox WITH patch IN @@inboxes');
    expect(call?.query).not.toContain('managedPurpose');
  });

  test('fences reconnect overwrite on the captured emailInboxes revision', async () => {
    const source = connector();
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; } };
    expect(await createInboxRepository(database as never).ensure(source, { name: 'Replacement' }, embedding, true, 'inbox-before-oauth')).toBeNull();
    expect(call?.query).toContain('existing._rev == @expectedRevision');
    expect(call?.query).toContain('IN @@inboxes');
    expect(call?.bindVars).toMatchObject({ '@inboxes': 'emailInboxes', expectedRevision: 'inbox-before-oauth' });
  });

  test('semantic search enforces organization, scope, connector, and active Gmail boundaries', async () => {
    const scopeKey = newId();
    const connectorKey = newId();
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { all: async () => [] }; } };
    expect(await createInboxRepository(database as never).search('organization', scopeKey, [connectorKey], embedding, '  Leadership  ', 0.55, 10)).toEqual([]);
    expect(call?.query).toContain('inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey');
    expect(call?.query).toContain('connector.provider == "gmail" && connector.status != "revoked"');
    expect(call?.query).toContain('FOR inbox IN @@inboxes');
    expect(call?.bindVars).toMatchObject({ '@inboxes': 'emailInboxes', connectorKeys: [connectorKey], query: 'leadership' });
  });
});
