import { createHash } from 'node:crypto';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { communicationHistoryInputSchema, userInboxMessageSchema, userInboxThreadListItemSchema, userInboxThreadSchema, type CommunicationHistoryInput, type UserInboxMessage, type UserInboxThread, type UserInboxThreadListItem } from './schemas';

export const USER_INBOX_THREADS_COLLECTION = 'userInboxThreads';
export const USER_INBOX_MESSAGES_COLLECTION = 'userInboxMessages';

type Cursor = { next(): Promise<unknown>; all?(): Promise<unknown[]> };
export interface UserInboxDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(collections: { read?: string[]; write: string[] }, operation: (database: UserInboxDatabase) => Promise<T>) => Promise<T>;

export type UserInboxResult<T> = { state: 'ok'; value: T } | { state: 'not_found' };
export type UserInboxSendResult = UserInboxResult<UserInboxMessage> | { state: 'conflict' };
export type UserInboxStaffReplyResult = UserInboxResult<{ message: UserInboxMessage; notificationKey: string; deliveries: number }> | { state: 'conflict' };
export class InvalidCommunicationCursorError extends Error {}

export interface UserInboxRepository {
  list(userKey: string, input: CommunicationHistoryInput): Promise<{ items: UserInboxThreadListItem[]; unreadCount: number; nextCursor: string | null }>;
  read(userKey: string, threadKey: string): Promise<UserInboxResult<{ thread: UserInboxThread; messages: UserInboxMessage[] }>>;
  markRead(userKey: string, threadKey: string, readAt: string | null): Promise<UserInboxResult<UserInboxThread>>;
  send(userKey: string, message: UserInboxMessage, now: string): Promise<UserInboxSendResult>;
  staffReply(staffUserKey: string, threadKey: string, messageKey: string, body: string, idempotencyKey: string, now: string): Promise<UserInboxStaffReplyResult>;
}

export function createUserInboxRepository(database: UserInboxDatabase = db as unknown as UserInboxDatabase, transact: TransactionRunner = (collections, operation) => withTransaction(collections, operation as never)) : UserInboxRepository {
  return {
    async list(userKey, rawInput) {
      const input = communicationHistoryInputSchema.parse(rawInput);
      const cursor = await database.query(`
        LET cursorThread = @cursor == null ? null : FIRST(FOR item IN userInboxThreads FILTER item._key == @cursor && item.userKey == @userKey LIMIT 1 RETURN item)
        LET unreadCount = LENGTH(FOR item IN userInboxThreads FILTER item.userKey == @userKey && item.readAt == null RETURN 1)
        LET items = (FOR thread IN userInboxThreads
          FILTER thread.userKey == @userKey
          FILTER @mailbox == "inbox" || LENGTH(FOR message IN userInboxMessages FILTER message.threadKey == thread._key && message.userKey == @userKey && message.sender == "user" LIMIT 1 RETURN 1) > 0
          FILTER cursorThread == null || thread.lastMessageAt < cursorThread.lastMessageAt || (thread.lastMessageAt == cursorThread.lastMessageAt && thread._key < cursorThread._key)
          SORT thread.lastMessageAt DESC, thread._key DESC LIMIT @pageSize
          LET latestMessage = FIRST(FOR message IN userInboxMessages FILTER message.threadKey == thread._key SORT message.createdAt DESC, message._key DESC LIMIT 1 RETURN message.body)
          RETURN MERGE(thread, { preview: latestMessage ?? "" }))
        RETURN { cursorValid: @cursor == null || cursorThread != null, unreadCount, items }
      `, { userKey, ...input, cursor: input.cursor ?? null, pageSize: input.limit + 1 });
      const result = await cursor.next() as { cursorValid: boolean; unreadCount: number; items: Record<string, unknown>[] } | undefined;
      if (!result?.cursorValid) throw new InvalidCommunicationCursorError('Invalid communication cursor.');
      const parsed = (result.items ?? []).map((item) => userInboxThreadListItemSchema.parse(withArangoKey(item)));
      const items = parsed.slice(0, input.limit);
      return { items, unreadCount: result.unreadCount ?? 0, nextCursor: parsed.length > input.limit ? items.at(-1)?.key ?? null : null };
    },
    async read(userKey, threadKey) {
      const cursor = await database.query(`
        LET thread = DOCUMENT(userInboxThreads, @threadKey)
        FILTER thread != null && thread.userKey == @userKey
        LET messages = (FOR message IN userInboxMessages FILTER message.threadKey == thread._key && message.userKey == @userKey SORT message.createdAt ASC, message._key ASC RETURN message)
        RETURN { thread, messages }
      `, { userKey, threadKey });
      const row = await cursor.next() as { thread: Record<string, unknown>; messages: Record<string, unknown>[] } | undefined;
      if (!row) return { state: 'not_found' };
      return { state: 'ok', value: { thread: userInboxThreadSchema.parse(withArangoKey(row.thread)), messages: row.messages.map((message) => userInboxMessageSchema.parse(withArangoKey(message))) } };
    },
    async markRead(userKey, threadKey, readAt) {
      const cursor = await database.query('FOR thread IN userInboxThreads FILTER thread._key == @threadKey && thread.userKey == @userKey UPDATE thread WITH { readAt: @readAt, updatedAt: @now } IN userInboxThreads RETURN NEW', { userKey, threadKey, readAt, now: new Date().toISOString() });
      const value = await cursor.next() as Record<string, unknown> | undefined;
      return value ? { state: 'ok', value: userInboxThreadSchema.parse(withArangoKey(value)) } : { state: 'not_found' };
    },
    async send(userKey, message, now) {
      const value = userInboxMessageSchema.parse(message);
      return transact({ write: [USER_INBOX_THREADS_COLLECTION, USER_INBOX_MESSAGES_COLLECTION] }, async (transaction) => {
        const cursor = await transaction.query(`
           LET thread = DOCUMENT(userInboxThreads, @threadKey)
           FILTER thread != null && thread.userKey == @userKey
           LET existing = FIRST(FOR item IN userInboxMessages FILTER item.threadKey == thread._key && item.userKey == @userKey && item.sender == "user" && item.idempotencyKey == @message.idempotencyKey LIMIT 1 RETURN item)
           LET created = existing == null ? FIRST(INSERT MERGE(@message, { teamKey: thread.teamKey, scopeKey: thread.scopeKey }) INTO userInboxMessages RETURN NEW) : existing
           LET updated = existing == null ? FIRST(UPDATE thread WITH { lastMessageAt: @now, updatedAt: @now } IN userInboxThreads RETURN NEW) : thread
           RETURN { message: created, conflict: existing != null && existing.requestHash != @message.requestHash }
         `, { threadKey: value.threadKey, userKey, message: toArangoDoc(value), now });
        const created = await cursor.next() as { message: Record<string, unknown>; conflict: boolean } | undefined;
        if (!created) return { state: 'not_found' };
        if (created.conflict) return { state: 'conflict' };
        return { state: 'ok', value: userInboxMessageSchema.parse(withArangoKey(created.message)) };
      });
    },
    async staffReply(staffUserKey, threadKey, messageKey, body, idempotencyKey, now) {
      return transact({ read: ['pushSubscriptions'], write: [USER_INBOX_THREADS_COLLECTION, USER_INBOX_MESSAGES_COLLECTION, 'appNotifications', 'appNotificationRecipients', 'pushDeliveries'] }, async (transaction) => {
        const notificationKey = newId();
        const requestHash = createHash('sha256').update(JSON.stringify({ threadKey, body })).digest('hex');
        const cursor = await transaction.query(`
          LET thread = DOCUMENT(userInboxThreads, @threadKey)
          FILTER thread != null
          LET existing = FIRST(FOR item IN appNotifications FILTER item.teamKey == thread.teamKey && item.actorUserKey == @staffUserKey && item.idempotencyKey == @idempotencyKey LIMIT 1 RETURN item)
          LET selectedMessageKey = existing == null ? @messageKey : existing.signalMessageKey
          LET inserted = existing == null ? (INSERT { _key: @messageKey, threadKey: thread._key, teamKey: thread.teamKey, scopeKey: thread.scopeKey, userKey: thread.userKey, sender: "staff", senderUserKey: @staffUserKey, body: @body, createdAt: @now } INTO userInboxMessages RETURN NEW) : []
          LET updated = existing == null ? (UPDATE thread WITH { readAt: null, lastMessageAt: @now, updatedAt: @now } IN userInboxThreads RETURN NEW) : []
          LET subscriptions = existing == null ? (FOR item IN pushSubscriptions FILTER item.userKey == thread.userKey RETURN item) : []
          LET createdNotification = existing == null ? (INSERT { _key: @notificationKey, actorUserKey: @staffUserKey, teamKey: thread.teamKey, scopeKey: thread.scopeKey, idempotencyKey: @idempotencyKey, requestHash: @requestHash, title: thread.subject, message: @body, recipientCount: 1, deliveryCount: LENGTH(subscriptions), signalThreadKey: thread._key, signalMessageKey: @messageKey, createdAt: @now } INTO appNotifications RETURN NEW) : []
          LET recipient = existing == null ? (INSERT { _key: CONCAT(@notificationKey, "-", thread.userKey), notificationKey: @notificationKey, userKey: thread.userKey, teamKey: thread.teamKey, threadKey: thread._key, messageKey: @messageKey, readAt: null, createdAt: @now, updatedAt: @now } INTO appNotificationRecipients RETURN 1) : []
          LET deliveries = existing == null ? (FOR subscription IN subscriptions INSERT { _key: CONCAT(@notificationKey, "-", subscription._key), notificationKey: @notificationKey, subscriptionKey: subscription._key, userKey: thread.userKey, projectId: subscription.projectId, signalThreadKey: thread._key, signalMessageKey: @messageKey, status: "queued", attempts: 0, createdAt: @now, updatedAt: @now } INTO pushDeliveries RETURN 1) : []
          LET message = DOCUMENT(userInboxMessages, selectedMessageKey)
          RETURN { conflict: existing != null && existing.requestHash != @requestHash, message, notificationKey: existing == null ? @notificationKey : existing._key, deliveries: existing == null ? LENGTH(deliveries) : existing.deliveryCount }
        `, { staffUserKey, threadKey, messageKey, body: userInboxMessageSchema.shape.body.parse(body), idempotencyKey, notificationKey, requestHash, now });
        const row = await cursor.next() as { conflict: boolean; message: Record<string, unknown>; notificationKey: string; deliveries: number } | undefined;
        if (!row) return { state: 'not_found' };
        if (row.conflict) return { state: 'conflict' };
        return { state: 'ok', value: { message: userInboxMessageSchema.parse(withArangoKey(row.message)), notificationKey: row.notificationKey, deliveries: row.deliveries } };
      });
    },
  };
}

let defaultRepository: UserInboxRepository | undefined;
export function getDefaultUserInboxRepository() { return defaultRepository ??= createUserInboxRepository(); }
