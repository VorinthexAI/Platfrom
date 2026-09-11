import type { Database } from 'arangojs';
import { newId } from '@/lib/ids';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function migrateUserInbox(database: Database) {
  for (const name of ['userInboxThreads', 'userInboxMessages']) {
    const collection = database.collection(name);
    if (!await collection.exists()) await collection.create();
  }
  await database.collection('userInboxMessages').ensureIndex({ type: 'persistent', fields: ['threadKey', 'userKey', 'idempotencyKey'], unique: true, sparse: true });
  const tickets = await (await database.query<Record<string, unknown>>('FOR ticket IN tickets FILTER !IS_STRING(ticket.threadKey) RETURN ticket')).all();
  for (const ticket of tickets) await database.query(`
    LET ticket = DOCUMENT(tickets, @ticketKey) FILTER ticket != null && !IS_STRING(ticket.threadKey)
    INSERT { _key: @threadKey, teamKey: ticket.teamKey, scopeKey: ticket.scopeKey, userKey: ticket.userKey, kind: ticket.type == "feedback" ? "feedback" : "issue", subject: ticket.type == "feedback" ? "Product feedback" : "Support issue", ticketKey: ticket._key, createdBy: "user", readAt: ticket.createdAt, lastMessageAt: ticket.createdAt, createdAt: ticket.createdAt, updatedAt: ticket.createdAt } INTO userInboxThreads
    INSERT { _key: @messageKey, threadKey: @threadKey, teamKey: ticket.teamKey, scopeKey: ticket.scopeKey, userKey: ticket.userKey, sender: "user", senderUserKey: ticket.userKey, body: ticket.message, createdAt: ticket.createdAt } INTO userInboxMessages
    UPDATE ticket WITH { threadKey: @threadKey, initialMessageKey: @messageKey, upvotes: null, downvotes: null } IN tickets OPTIONS { keepNull: false }
  `, { ticketKey: String(ticket._key), threadKey: newId(), messageKey: newId() });

  const recipients = await (await database.query<{ key: string }>('FOR recipient IN appNotificationRecipients FILTER !IS_STRING(recipient.threadKey) RETURN { key: recipient._key }')).all();
  for (const recipient of recipients) await database.query(`
    LET recipient = DOCUMENT(appNotificationRecipients, @recipientKey) LET notification = recipient == null ? null : DOCUMENT(appNotifications, recipient.notificationKey)
    FILTER recipient != null && notification != null && !IS_STRING(recipient.threadKey)
    INSERT { _key: @threadKey, teamKey: recipient.teamKey, scopeKey: notification.scopeKey, userKey: recipient.userKey, kind: "notification", subject: notification.title, notificationKey: notification._key, createdBy: "system", readAt: recipient.readAt, lastMessageAt: recipient.createdAt, createdAt: recipient.createdAt, updatedAt: recipient.updatedAt } INTO userInboxThreads
    INSERT { _key: @messageKey, threadKey: @threadKey, teamKey: recipient.teamKey, scopeKey: notification.scopeKey, userKey: recipient.userKey, sender: "system", senderUserKey: notification.actorUserKey, body: notification.message, createdAt: recipient.createdAt } INTO userInboxMessages
    UPDATE recipient WITH { threadKey: @threadKey, messageKey: @messageKey } IN appNotificationRecipients
    FOR delivery IN pushDeliveries FILTER delivery.notificationKey == notification._key && delivery.userKey == recipient.userKey UPDATE delivery WITH { signalThreadKey: @threadKey, signalMessageKey: @messageKey } IN pushDeliveries
  `, { recipientKey: recipient.key, threadKey: newId(), messageKey: newId() });

  const votes = database.collection('ticketVotes');
  if (await votes.exists()) await votes.drop();
}

export const userInboxMigration: GraphMigration = { id: '0009-user-inbox', checksum: () => checksumMigrationFiles([new URL(import.meta.url)]), up: migrateUserInbox };
