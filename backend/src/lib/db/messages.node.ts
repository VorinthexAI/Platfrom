import { z } from 'zod';
import { createNodeHelpers } from './base';

export const MESSAGES_COLLECTION = 'messages';
export const messageSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  threadKey: z.string().cuid().optional(),
  authorParticipantKey: z.string().cuid(),
  content: z.string().min(1),
  replyToMessageKey: z.string().cuid().optional(),
  editedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
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
