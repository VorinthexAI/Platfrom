import { z } from 'zod';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { USER_NOTIFICATIONS_COLLECTION, safeUserNotificationSchema, userNotificationListInputSchema, userNotificationSchema, type SafeUserNotification, type UserNotification } from './schemas';

export class InvalidUserNotificationCursorError extends Error {
  constructor() { super('Notification cursor is invalid.'); }
}

type QueryDatabase = Pick<typeof db, 'query'>;
export interface UserNotificationRepository {
  list(userKey: string, input: z.output<typeof userNotificationListInputSchema>): Promise<{ items: SafeUserNotification[]; nextCursor: string | null }>;
  get(userKey: string, notificationKey: string): Promise<UserNotification | null>;
  search(userKey: string, embedding: number[], query: string, input: { readState?: 'read' | 'unread'; createdFrom?: string; createdTo?: string; limit: number }): Promise<Array<SafeUserNotification & { score: number }>>;
  markRead(userKey: string, notificationKey: string, readAt: string | null): Promise<SafeUserNotification | null>;
}

function publicNotification(value: UserNotification, score?: number) {
  const destination = value.kind === 'email-thread' && value.connectorKey && value.threadKey
    ? { kind: value.kind, connectorKey: value.connectorKey, threadKey: value.threadKey, ...(value.messageKey ? { messageKey: value.messageKey } : {}) }
    : {};
  return safeUserNotificationSchema.extend({ score: z.number().optional() }).parse({ key: value.key, title: value.title, message: value.message, isRead: value.readAt !== null, createdAt: value.createdAt, ...destination, ...(score === undefined ? {} : { score }) });
}

export function createUserNotificationRepository(database: QueryDatabase = db): UserNotificationRepository {
  return {
    async list(userKey, rawInput) {
      const input = userNotificationListInputSchema.parse(rawInput);
      const cursor = await database.query<{ items: Record<string, unknown>[] }>(`
        LET cursorItem = @cursor == null ? null : FIRST(FOR item IN @@collection FILTER item._key == @cursor && item.userKey == @userKey LIMIT 1 RETURN item)
        FILTER @cursor == null || cursorItem != null
        LET items = (FOR item IN @@collection
          FILTER item.userKey == @userKey
          FILTER @readState == "unread" ? item.readAt == null : item.readAt != null
          FILTER cursorItem == null || item.createdAt < cursorItem.createdAt || (item.createdAt == cursorItem.createdAt && item._key < cursorItem._key)
          SORT item.createdAt DESC, item._key DESC
          LIMIT @pageSize
          RETURN item)
        RETURN { items }
      `, { '@collection': USER_NOTIFICATIONS_COLLECTION, userKey: z.string().cuid().parse(userKey), cursor: input.cursor ?? null, readState: input.readState, pageSize: input.limit + 1 });
      const row = await cursor.next();
      if (input.cursor && !row) throw new InvalidUserNotificationCursorError();
      const parsed = (row?.items ?? []).map((item) => userNotificationSchema.parse(withArangoKey(item as Record<string, unknown>)));
      const items = parsed.slice(0, input.limit).map((item) => publicNotification(item));
      return { items, nextCursor: parsed.length > input.limit ? parsed[input.limit - 1]!.key : null };
    },
    async get(userKey, notificationKey) {
      const cursor = await database.query('FOR item IN @@collection FILTER item._key == @notificationKey && item.userKey == @userKey LIMIT 1 RETURN item', { '@collection': USER_NOTIFICATIONS_COLLECTION, userKey: z.string().cuid().parse(userKey), notificationKey: z.string().cuid().parse(notificationKey) });
      const row = await cursor.next();
      return row ? userNotificationSchema.parse(withArangoKey(row as Record<string, unknown>)) : null;
    },
    async search(userKey, embedding, query, input) {
      const cursor = await database.query<{ item: Record<string, unknown>; score: number }>(`
        FOR item IN @@collection
          FILTER item.userKey == @userKey
          FILTER @readState == null || (@readState == "unread" ? item.readAt == null : item.readAt != null)
          FILTER @createdFrom == null || item.createdAt >= @createdFrom
          FILTER @createdTo == null || item.createdAt <= @createdTo
          LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", item.title, item.message)), @query)
          LET score = COSINE_SIMILARITY(item.embedding, @embedding)
          FILTER direct || IS_NUMBER(score) && score >= -1
          SORT direct DESC, score DESC, item.createdAt DESC, item._key DESC
          LIMIT @limit
          RETURN { item, score: direct ? 1 : score }
      `, { '@collection': USER_NOTIFICATIONS_COLLECTION, userKey: z.string().cuid().parse(userKey), embedding: currentEmbeddingSchema.parse(embedding), query: query.trim().toLowerCase(), readState: input.readState ?? null, createdFrom: input.createdFrom ?? null, createdTo: input.createdTo ?? null, limit: input.limit });
      return (await cursor.all()).map((row) => publicNotification(userNotificationSchema.parse(withArangoKey(row.item)), row.score) as SafeUserNotification & { score: number });
    },
    async markRead(userKey, notificationKey, readAt) {
      const cursor = await database.query('FOR item IN @@collection FILTER item._key == @notificationKey && item.userKey == @userKey UPDATE item WITH { readAt: @readAt } IN @@collection RETURN NEW', { '@collection': USER_NOTIFICATIONS_COLLECTION, userKey: z.string().cuid().parse(userKey), notificationKey: z.string().cuid().parse(notificationKey), readAt });
      const row = await cursor.next();
      return row ? publicNotification(userNotificationSchema.parse(withArangoKey(row as Record<string, unknown>))) : null;
    },
  };
}

export const userNotificationRepository = createUserNotificationRepository();
