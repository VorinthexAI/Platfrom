import { z } from 'zod';
import { createNodeHelpers } from './base';

export const USER_REACTIONS_COLLECTION = 'userReactions';
export const userReactionSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  reactionSlug: z.string().trim().min(1).max(64),
  count: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});
const helpers = createNodeHelpers(USER_REACTIONS_COLLECTION, userReactionSchema, []);
export const upsertUserReactionByKey = helpers.upsertByKey;
export const getAllUserReactionsChunked = helpers.getAllChunked;
export const listUserReactionsPage = helpers.listPage;
