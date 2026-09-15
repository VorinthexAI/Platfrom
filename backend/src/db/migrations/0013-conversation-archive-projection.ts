import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function migrateConversationArchiveProjection(database: Database) {
  const states = database.collection('conversationArchiveStates');
  if (!await states.exists()) await states.create();
  await states.ensureIndex({ type: 'persistent', fields: ['conversationKey'], unique: true });
  await states.ensureIndex({ type: 'persistent', fields: ['projectedRevision', 'desiredRevision', 'updatedAt'] });
  await states.ensureIndex({ type: 'persistent', fields: ['teamKey', 'scopeKey', 'userKey'] });
  await database.collection('folders').ensureIndex({ type: 'persistent', fields: ['scopeKey', 'privateOwnerUserKey', 'parentFolderKey'], sparse: true });
  await database.collection('documents').ensureIndex({ type: 'persistent', fields: ['scopeKey', 'privateOwnerUserKey', 'folderKey'], sparse: true });
}

export const conversationArchiveProjectionMigration: GraphMigration = {
  id: '0013-conversation-archive-projection',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: migrateConversationArchiveProjection,
};
