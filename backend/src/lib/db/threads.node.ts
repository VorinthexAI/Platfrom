import { z } from 'zod';
import { createNodeHelpers } from './base';

export const THREADS_COLLECTION = 'threads';
export const threadSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  title: z.string().trim().min(1).optional(),
  rootMessageKey: z.string().cuid(),
  status: z.enum(['open', 'resolved', 'archived']).default('open'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});

export type Thread = z.infer<typeof threadSchema>;
export const threadsEmbeddingFields = ['title'] as const;
const helpers = createNodeHelpers(THREADS_COLLECTION, threadSchema, threadsEmbeddingFields);
export const insertThread = helpers.insert;
export const getThreadById = helpers.getById;
export const updateThread = helpers.updateById;
export const deleteThread = helpers.deleteById;
export const upsertThreadByKey = helpers.upsertByKey;
export const getAllThreadsChunked = helpers.getAllChunked;
export const listThreadsPage = helpers.listPage;
