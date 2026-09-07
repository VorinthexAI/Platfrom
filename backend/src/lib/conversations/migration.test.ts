import { describe, expect, test } from 'bun:test';
import { collections } from '@/db/arango-migrate';
import { SCOPE_KEYED_REMOVAL_COLLECTIONS } from '@/lib/ai/scopes/repository';

describe('conversation persistence migration', () => {
  test('creates private collections and ownership/idempotency indexes', () => {
    expect(collections.find(({ name }) => name === 'conversations')).toEqual({ name: 'conversations', skipEmbedding: true, indexes: [{ fields: ['teamKey', 'scopeKey', 'userKey', 'isFavorite', 'updatedAt'] }, { fields: ['teamKey', 'scopeKey', 'userKey', 'updatedAt'] }] });
    expect(collections.find(({ name }) => name === 'conversationMessages')).toEqual({ name: 'conversationMessages', skipEmbedding: true, indexes: [{ fields: ['conversationKey', 'userKey', 'turnKey', 'role'], unique: true }, { fields: ['teamKey', 'scopeKey', 'userKey', 'conversationKey', 'createdAt'] }, { fields: ['conversationKey', 'role', 'status'] }] });
  });

  test('backfills deterministic request hashes before strict reads', async () => {
    const source = await Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("if (spec.name === 'conversationMessages')");
    expect(source).toContain('message.requestHash');
    expect(source).toContain('SHA256(CONCAT_SEPARATOR');
  });

  test('tears messages and conversations down with their scope', async () => {
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('conversationMessages');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('conversations');
  });
});
