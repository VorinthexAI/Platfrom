import { describe, expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { conversationMessageRecallIndexMigration, migrateConversationMessageRecallIndex } from './0010-conversation-message-recall-index';

describe('conversation message recall index migration', () => {
  test('adds and registers the owner-wide completed-message scan index', async () => {
    const indexes: unknown[] = [];
    const database = { collection: (name: string) => ({ ensureIndex: async (index: unknown) => { indexes.push({ name, index }); } }) };

    await migrateConversationMessageRecallIndex(database as never);

    expect(conversationMessageRecallIndexMigration.id).toBe('0010-conversation-message-recall-index');
    expect(indexes).toEqual([{ name: 'conversationMessages', index: { type: 'persistent', fields: ['teamKey', 'scopeKey', 'userKey', 'type', 'status', 'createdAt'] } }]);
    expect(graphMigrations.find(({ id }) => id === conversationMessageRecallIndexMigration.id)).toBe(conversationMessageRecallIndexMigration);
  });
});
