import { z } from 'zod';
import { createNodeHelpers } from './base';

export const MESSAGE_MENTIONS_COLLECTION = 'messageMentions';
export const messageMentionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  messageKey: z.string().cuid(),
  participantKey: z.string().cuid(),
  handledAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});

export type MessageMention = z.infer<typeof messageMentionSchema>;
export const messageMentionsEmbeddingFields = [] as const;
const helpers = createNodeHelpers(MESSAGE_MENTIONS_COLLECTION, messageMentionSchema, messageMentionsEmbeddingFields);
export const insertMessageMention = helpers.insert;
export const getMessageMentionById = helpers.getById;
export const updateMessageMention = helpers.updateById;
export const deleteMessageMention = helpers.deleteById;
export const upsertMessageMentionByKey = helpers.upsertByKey;
export const getAllMessageMentionsChunked = helpers.getAllChunked;
export const listMessageMentionsPage = helpers.listPage;
