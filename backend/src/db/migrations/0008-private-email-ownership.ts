import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

const privateEmailCollections = [
  'emailInboxes',
  'emailThreads',
  'emailMessages',
  'emailDrafts',
  'emailTones',
  'emailReplyContext',
  'emailWritingProfiles',
  'emailAttachments',
] as const;
const userNamespaceCollections = new Set(['emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles']);

export async function migratePrivateEmailOwnership(database: Database) {
  const users = database.collection('userConnectors');
  if (!(await users.exists())) await users.create();

  if (await database.collection('teamConnectors').exists()) {
    await database.query(`
      FOR connector IN teamConnectors
        LET creator = connector.createdByTeamMembershipKey == null ? null : DOCUMENT(userTeams, connector.createdByTeamMembershipKey)
        LET userKey = connector.billingUserKey != null ? connector.billingUserKey : creator == null ? null : creator.userId
        LET resolved = userKey != null && DOCUMENT(users, userKey) != null
        LET newerDuplicate = resolved ? FIRST(
          FOR other IN teamConnectors
            LET otherCreator = other.createdByTeamMembershipKey == null ? null : DOCUMENT(userTeams, other.createdByTeamMembershipKey)
            LET otherUserKey = other.billingUserKey != null ? other.billingUserKey : otherCreator == null ? null : otherCreator.userId
            FILTER other._key != connector._key && otherUserKey == userKey
            FILTER other.provider == connector.provider && other.providerAccountId == connector.providerAccountId
            FILTER other.updatedAt > connector.updatedAt || (other.updatedAt == connector.updatedAt && other._key > connector._key)
            LIMIT 1
            RETURN true
        ) : null
        LET migrate = resolved && newerDuplicate == null
        LET copied = FIRST(FOR ignored IN migrate ? [1] : []
          UPSERT { _key: connector._key }
            INSERT UNSET(MERGE(connector, { userKey }), ["_id", "_rev", "billingUserKey", "createdByTeamMembershipKey"])
            UPDATE UNSET(MERGE(connector, { userKey }), ["_id", "_rev", "billingUserKey", "createdByTeamMembershipKey"])
          IN userConnectors RETURN NEW._key)
        UPDATE connector WITH {
          status: "revoked", syncEnabled: false, encryptedCredentials: "revoked",
          accessTokenFingerprint: SHA256(CONCAT("ownership-migration:", connector._key)),
          revokedAt: DATE_ISO8601(DATE_NOW()), ownershipMigratedTo: copied
        } IN teamConnectors OPTIONS { keepNull: false }
    `);
  }

  for (const collectionName of privateEmailCollections) {
    const collection = database.collection(collectionName);
    if (!(await collection.exists())) continue;
    await database.query(`
      FOR value IN @@collection
        LET connectorKey = value.connectorKey != null ? value.connectorKey : value.accountKey
        LET connector = connectorKey == null ? null : DOCUMENT(userConnectors, connectorKey)
        LET scopeOwners = connector == null ? UNIQUE(
          FOR candidate IN userConnectors FILTER candidate.scopeKey == value.scopeKey RETURN candidate.userKey
        ) : []
        LET userKey = connector != null ? connector.userKey : LENGTH(scopeOwners) == 1 ? scopeOwners[0] : null
        UPDATE value WITH (userKey == null
          ? { privateVisibility: "revoked", userKey: null }
          : MERGE(
              { userKey, privateVisibility: null },
              @useUserNamespace ? { scopeKey: userKey } : {},
              @migrateUnassignedDraft && value.accountKey == value.scopeKey ? { accountKey: userKey } : {}
            ))
        IN @@collection OPTIONS { keepNull: false }
    `, { '@collection': collectionName, useUserNamespace: userNamespaceCollections.has(collectionName), migrateUnassignedDraft: collectionName === 'emailDrafts' });
    await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'updatedAt'] });
  }

  await users.ensureIndex({ type: 'persistent', fields: ['userKey', 'provider', 'providerAccountId'], unique: true });
  await users.ensureIndex({ type: 'persistent', fields: ['userKey', 'provider', 'status'] });
  await users.ensureIndex({ type: 'persistent', fields: ['email', 'syncEnabled'] });
  await users.ensureIndex({ type: 'persistent', fields: ['syncEnabled', 'watchExpiresAt'] });
}

export const privateEmailOwnershipMigration: GraphMigration = {
  id: '0008-private-email-ownership',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: migratePrivateEmailOwnership,
};
