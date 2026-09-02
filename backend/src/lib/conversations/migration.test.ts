import { describe, expect, test } from 'bun:test';
import { collections } from '@/db/arango-migrate';

describe('conversation persistence migration', () => {
  test('creates private collections and ownership/idempotency indexes', () => {
    expect(collections.find(({ name }) => name === 'conversations')).toEqual({ name: 'conversations', skipEmbedding: true, indexes: [{ fields: ['organizationKey', 'scopeKey', 'userKey', 'isFavorite', 'updatedAt'] }, { fields: ['organizationKey', 'scopeKey', 'userKey', 'updatedAt'] }] });
    expect(collections.find(({ name }) => name === 'conversationMessages')).toEqual({ name: 'conversationMessages', skipEmbedding: true, indexes: [{ fields: ['conversationKey', 'userKey', 'turnKey', 'role'], unique: true }, { fields: ['organizationKey', 'scopeKey', 'userKey', 'conversationKey', 'createdAt'] }, { fields: ['conversationKey', 'role', 'status'] }] });
  });

  test('backfills deterministic request hashes before strict reads', async () => {
    const source = await Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("if (spec.name === 'conversationMessages')");
    expect(source).toContain('message.requestHash');
    expect(source).toContain('SHA256(CONCAT_SEPARATOR');
  });

  test('tears messages and conversations down with their scope', async () => {
    const source = await Bun.file(new URL('../ai/scopes/repository.ts', import.meta.url)).text();
    const teardown = source.slice(source.indexOf('async removeScope(scopeKey)'), source.indexOf('async addScopeRelation'));
    expect(teardown).toContain('FOR item IN conversationMessages FILTER item.scopeKey == @scopeKey REMOVE item IN conversationMessages');
    expect(teardown).toContain('FOR item IN conversations FILTER item.scopeKey == @scopeKey REMOVE item IN conversations');
    expect(teardown.indexOf('cleanupConversationMessages')).toBeLessThan(teardown.indexOf('cleanupConversations'));
  });
});
