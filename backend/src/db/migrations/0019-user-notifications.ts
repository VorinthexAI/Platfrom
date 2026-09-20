import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function migrateUserNotifications(database: Database) {
  const collection = database.collection('userNotifications');
  if (!await collection.exists()) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'createdAt'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'readAt', 'createdAt'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['sourceKey', 'userKey'], unique: true, sparse: true });
  await database.query(`
    FOR thread IN userInboxThreads
      FILTER thread.kind == "notification"
      LET existing = FIRST(FOR item IN userNotifications FILTER item._key == thread._key LIMIT 1 RETURN item)
      FILTER existing == null
      LET message = FIRST(FOR item IN userInboxMessages FILTER item.threadKey == thread._key SORT item.createdAt ASC, item._key ASC LIMIT 1 RETURN item)
      FILTER message != null
      LET source = thread.notificationKey == null ? null : DOCUMENT(appNotifications, thread.notificationKey)
      INSERT {
        _key: thread._key,
        userKey: thread.userKey,
        teamKey: thread.teamKey,
        scopeKey: thread.scopeKey,
        title: LEFT(thread.subject, 200),
        message: LEFT(message.body, 8000),
        readAt: thread.readAt,
        sourceKey: thread.notificationKey,
        createdAt: thread.createdAt,
        embedding: source != null && IS_ARRAY(source.embedding) && LENGTH(source.embedding) > 0 ? source.embedding : null
      } INTO userNotifications
  `);
}

export const userNotificationsMigration: GraphMigration = {
  id: '0019-user-notifications',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: migrateUserNotifications,
};
