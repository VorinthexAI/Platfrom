import { z } from 'zod';

export const userInboxKindSchema = z.enum(['notification', 'issue', 'feedback']);
export const userInboxSenderSchema = z.enum(['user', 'system', 'staff']);
export const userInboxMailboxSchema = z.enum(['inbox', 'sent']);

export const userInboxThreadSchema = z.object({
  key: z.string().cuid(),
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  kind: userInboxKindSchema,
  subject: z.string().trim().min(1).max(200),
  ticketKey: z.string().cuid().optional(),
  notificationKey: z.string().cuid().optional(),
  createdBy: userInboxSenderSchema,
  readAt: z.string().datetime().nullable(),
  lastMessageAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const userInboxMessageSchema = z.object({
  key: z.string().cuid(),
  threadKey: z.string().cuid(),
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  sender: userInboxSenderSchema,
  senderUserKey: z.string().cuid().optional(),
  body: z.string().trim().min(1).max(8_000),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: z.string().datetime(),
});

export const userInboxThreadListItemSchema = userInboxThreadSchema.extend({ preview: userInboxMessageSchema.shape.body });

export const communicationHistoryInputSchema = z.object({
  mailbox: userInboxMailboxSchema.default('inbox'),
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();
export const communicationThreadInputSchema = z.object({ threadKey: z.string().cuid() }).strict();
export const communicationMarkReadInputSchema = z.object({ threadKey: z.string().cuid(), read: z.boolean().default(true) }).strict();
export const communicationSendInputSchema = z.object({ threadKey: z.string().cuid(), message: userInboxMessageSchema.shape.body }).strict();
export const communicationStaffReplyInputSchema = z.object({ threadKey: z.string().cuid(), message: userInboxMessageSchema.shape.body }).strict();

export type UserInboxThread = z.infer<typeof userInboxThreadSchema>;
export type UserInboxMessage = z.infer<typeof userInboxMessageSchema>;
export type UserInboxThreadListItem = z.infer<typeof userInboxThreadListItemSchema>;
export type CommunicationHistoryInput = z.output<typeof communicationHistoryInputSchema>;
