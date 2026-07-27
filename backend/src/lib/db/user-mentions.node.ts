import { z } from 'zod';
import { createNodeHelpers } from './base';

export const USER_MENTIONS_COLLECTION = 'userMentions';
export const userMentionSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  sourceId: z.string().trim().min(1).max(160),
  count: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});
export type UserMention = z.infer<typeof userMentionSchema>;
const helpers = createNodeHelpers(USER_MENTIONS_COLLECTION, userMentionSchema, []);
export const upsertUserMentionByKey = helpers.upsertByKey;
export const getAllUserMentionsChunked = helpers.getAllChunked;
export const listUserMentionsPage = helpers.listPage;
