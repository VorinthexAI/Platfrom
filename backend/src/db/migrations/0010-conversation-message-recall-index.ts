import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function migrateConversationMessageRecallIndex(database: Database) {
  await database.collection('conversationMessages').ensureIndex({
    type: 'persistent',
    fields: ['teamKey', 'scopeKey', 'userKey', 'type', 'status', 'createdAt'],
  });
}

export const conversationMessageRecallIndexMigration: GraphMigration = {
  id: '0010-conversation-message-recall-index',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: migrateConversationMessageRecallIndex,
};
