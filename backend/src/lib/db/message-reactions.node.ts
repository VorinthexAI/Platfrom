import { z } from 'zod';
import { createNodeHelpers } from './base';

export const MESSAGE_REACTIONS_COLLECTION = 'messageReactions';
export const messageReactionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  messageKey: z.string().cuid(),
  participantKey: z.string().cuid(),
  reaction: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});

export type MessageReaction = z.infer<typeof messageReactionSchema>;
export const messageReactionsEmbeddingFields = ['reaction'] as const;
const helpers = createNodeHelpers(MESSAGE_REACTIONS_COLLECTION, messageReactionSchema, messageReactionsEmbeddingFields);
export const insertMessageReaction = helpers.insert;
export const getMessageReactionById = helpers.getById;
export const updateMessageReaction = helpers.updateById;
export const deleteMessageReaction = helpers.deleteById;
export const upsertMessageReactionByKey = helpers.upsertByKey;
export const getAllMessageReactionsChunked = helpers.getAllChunked;
export const listMessageReactionsPage = helpers.listPage;
