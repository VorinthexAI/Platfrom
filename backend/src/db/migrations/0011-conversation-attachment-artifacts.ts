import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function migrateConversationAttachmentArtifacts(database: Database) {
  const collection = database.collection('conversationAttachmentArtifacts');
  if (!await collection.exists()) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['teamKey', 'scopeKey', 'userKey', 'conversationKey', 'requestKey'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['userMessageKey', 'status'], sparse: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['status', 'availableAt'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['leaseExpiresAt'], sparse: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['expiresAt'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['stagedStorageKey'], unique: true });
}

export const conversationAttachmentArtifactsMigration: GraphMigration = { id: '0011-conversation-attachment-artifacts', checksum: () => checksumMigrationFiles([new URL(import.meta.url)]), up: migrateConversationAttachmentArtifacts };
