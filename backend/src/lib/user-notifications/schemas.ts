import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const USER_NOTIFICATIONS_COLLECTION = 'userNotifications';
export const userNotificationReadStateSchema = z.enum(['read', 'unread']);
export const userNotificationDestinationKindSchema = z.literal('email-thread');
export const userNotificationSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(8_000),
  readAt: z.string().datetime().nullable(),
  sourceKey: z.string().cuid().optional(),
  kind: userNotificationDestinationKindSchema.optional(),
  connectorKey: z.string().min(1).max(160).optional(),
  threadKey: z.string().min(1).max(160).optional(),
  messageKey: z.string().min(1).max(160).optional(),
  embedding: currentEmbeddingSchema.nullish(),
  createdAt: z.string().datetime(),
}).strip();
export const safeUserNotificationSchema = z.object({
  key: userNotificationSchema.shape.key,
  title: userNotificationSchema.shape.title,
  message: userNotificationSchema.shape.message,
  isRead: z.boolean(),
  createdAt: userNotificationSchema.shape.createdAt,
  kind: userNotificationDestinationKindSchema.optional(),
  connectorKey: z.string().min(1).max(160).optional(),
  threadKey: z.string().min(1).max(160).optional(),
  messageKey: z.string().min(1).max(160).optional(),
}).strict();
export const userNotificationListInputSchema = z.object({
  readState: userNotificationReadStateSchema,
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();
export const userNotificationMarkReadInputSchema = z.object({
  notificationKey: z.string().cuid(),
  read: z.boolean().default(true),
}).strict();
export const userNotificationListResultSchema = z.object({
  items: z.array(safeUserNotificationSchema),
  nextCursor: z.string().cuid().nullable(),
}).strict();

export type UserNotification = z.infer<typeof userNotificationSchema>;
export type SafeUserNotification = z.infer<typeof safeUserNotificationSchema>;
export type UserNotificationListInput = z.input<typeof userNotificationListInputSchema>;
