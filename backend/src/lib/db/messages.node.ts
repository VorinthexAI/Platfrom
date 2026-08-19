import { z } from 'zod';
import { createNodeHelpers } from './base';
import { communicationChannelKeySchema } from './communication-keys';

export const MESSAGES_COLLECTION = 'messages';
export const messageSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: communicationChannelKeySchema,
  threadKey: z.string().cuid().optional(),
  authorParticipantKey: z.string().cuid(),
  content: z.string().min(1),
  replyToMessageKey: z.string().cuid().optional(),
  editedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
  embeddingState: z.enum(['pending', 'ready', 'failed']).default('pending'),
  embeddingProvider: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  embeddedAt: z.string().datetime().optional(),
});

export type Message = z.infer<typeof messageSchema>;
export const messagesEmbeddingFields = ['content'] as const;
const helpers = createNodeHelpers(MESSAGES_COLLECTION, messageSchema, messagesEmbeddingFields);
export const insertMessage = helpers.insert;
export const getMessageById = helpers.getById;
export const updateMessage = helpers.updateById;
export const deleteMessage = helpers.deleteById;
export const upsertMessageByKey = helpers.upsertByKey;
export const getAllMessagesChunked = helpers.getAllChunked;
export const listMessagesPage = helpers.listPage;
