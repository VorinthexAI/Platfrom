import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function repairConversationArchiveProjection(database: Database) {
  const repairedAt = new Date().toISOString();
  await database.query(`
    FOR conversation IN conversations
      LET membership = FIRST(
        FOR candidate IN userTeams
          FILTER candidate.teamKey == conversation.teamKey
            && candidate.userId == conversation.userKey
            && candidate.status == "active"
          SORT candidate._key ASC
          LIMIT 1
          RETURN candidate
      )
      FILTER membership != null
      UPSERT { _key: conversation._key }
        INSERT {
          _key: conversation._key,
          conversationKey: conversation._key,
          teamKey: conversation.teamKey,
          scopeKey: conversation.scopeKey,
          userKey: conversation.userKey,
          actorKey: membership._key,
          desiredRevision: 1,
          projectedRevision: 0,
          createdAt: conversation.createdAt,
          updatedAt: @repairedAt
        }
        UPDATE {
          actorKey: membership._key,
          desiredRevision: OLD.desiredRevision + 1,
          updatedAt: @repairedAt
        }
        IN conversationArchiveStates
  `, { repairedAt });
}

export const repairConversationArchiveProjectionMigration: GraphMigration = {
  id: '0014-repair-conversation-archive-projection',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: repairConversationArchiveProjection,
};
