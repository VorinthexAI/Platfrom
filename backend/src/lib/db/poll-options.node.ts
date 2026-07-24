import { z } from 'zod';
import { createNodeHelpers } from './base';

export const POLL_OPTIONS_COLLECTION = 'pollOptions';
export const pollOptionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  pollKey: z.string().cuid(),
  text: z.string().trim().min(1).max(200),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});
export type PollOption = z.infer<typeof pollOptionSchema>;
export const pollOptionsEmbeddingFields = ['text'] as const;
const helpers = createNodeHelpers(POLL_OPTIONS_COLLECTION, pollOptionSchema, pollOptionsEmbeddingFields);
export const insertPollOption = helpers.insert;
export const getPollOptionById = helpers.getById;
export const updatePollOption = helpers.updateById;
export const deletePollOption = helpers.deleteById;
export const upsertPollOptionByKey = helpers.upsertByKey;
export const getAllPollOptionsChunked = helpers.getAllChunked;
export const listPollOptionsPage = helpers.listPage;
