import { z } from 'zod';
import { createNodeHelpers } from './base';

export const POLLS_COLLECTION = 'polls';
export const pollSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  messageKey: z.string().cuid(),
  creatorParticipantKey: z.string().cuid(),
  question: z.string().trim().min(1).max(500),
  allowMultiple: z.boolean().default(false),
  status: z.enum(['open', 'closed']).default('open'),
  closedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
}).superRefine((poll, ctx) => {
  if ((poll.status === 'closed') !== Boolean(poll.closedAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['closedAt'], message: 'Closed polls require closedAt; open polls prohibit it' });
});
export type Poll = z.infer<typeof pollSchema>;
export const pollsEmbeddingFields = ['question'] as const;
const helpers = createNodeHelpers(POLLS_COLLECTION, pollSchema, pollsEmbeddingFields);
export const insertPoll = helpers.insert;
export const getPollById = helpers.getById;
export const updatePoll = helpers.updateById;
export const deletePoll = helpers.deleteById;
export const upsertPollByKey = helpers.upsertByKey;
export const getAllPollsChunked = helpers.getAllChunked;
export const listPollsPage = helpers.listPage;
