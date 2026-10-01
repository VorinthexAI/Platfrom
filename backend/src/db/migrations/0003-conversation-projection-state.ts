import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function ensureConversationProjectionState(database: Database) {
  const collection = database.collection('conversationArchiveStates');
  if (!await collection.exists()) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'scopeKey', 'conversationKey'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['projectedRevision', 'desiredRevision'] });
}

export const conversationProjectionStateMigration: GraphMigration = {
  id: '0003-conversation-projection-state',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: ensureConversationProjectionState,
};
