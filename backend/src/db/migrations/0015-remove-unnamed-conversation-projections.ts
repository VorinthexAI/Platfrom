import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function removeUnnamedConversationProjections(database: Database) {
  const bindVars = { defaultName: 'New chat' };
  await database.query(`
    LET folderKeys = (
      FOR folder IN folders
        FILTER folder.managedPurpose IN ["conversation", "conversation-summaries"]
        LET conversation = DOCUMENT(conversations, folder.managedOwnerKey)
        FILTER conversation != null && conversation.name == @defaultName
        RETURN folder._key
    )
    FOR document IN documents
      FILTER document.folderKey IN folderKeys
        && document.managedPurpose IN ["conversation-message", "conversation-summary"]
      REMOVE document IN documents
  `, bindVars);
  await database.query(`
    FOR folder IN folders
      FILTER folder.managedPurpose IN ["conversation", "conversation-summaries"]
      LET conversation = DOCUMENT(conversations, folder.managedOwnerKey)
      FILTER conversation != null && conversation.name == @defaultName
      REMOVE folder IN folders
  `, bindVars);
  await database.query(`
    FOR state IN conversationArchiveStates
      LET conversation = DOCUMENT(conversations, state.conversationKey)
      FILTER conversation != null && conversation.name == @defaultName
      REMOVE state IN conversationArchiveStates
  `, bindVars);
  await database.query(`
    FOR root IN folders
      FILTER root.managedPurpose == "conversation-root"
      LET child = FIRST(
        FOR folder IN folders
          FILTER folder.parentFolderKey == root._key
            && folder.scopeKey == root.scopeKey
            && folder.privateOwnerUserKey == root.privateOwnerUserKey
            && folder.managedPurpose == "conversation"
          LIMIT 1
          RETURN true
      )
      FILTER child == null
      REMOVE root IN folders
  `);
}

export const removeUnnamedConversationProjectionsMigration: GraphMigration = {
  id: '0015-remove-unnamed-conversation-projections',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: removeUnnamedConversationProjections,
};
