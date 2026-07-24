import { z } from 'zod';
import { createNodeHelpers } from './base';

export const POLL_VOTES_COLLECTION = 'pollVotes';
export const pollVoteSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: z.string().cuid(),
  pollKey: z.string().cuid(),
  optionKey: z.string().cuid(),
  participantKey: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
});
export type PollVote = z.infer<typeof pollVoteSchema>;
export const pollVotesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(POLL_VOTES_COLLECTION, pollVoteSchema, pollVotesEmbeddingFields);
export const insertPollVote = helpers.insert;
export const getPollVoteById = helpers.getById;
export const updatePollVote = helpers.updateById;
export const deletePollVote = helpers.deleteById;
export const upsertPollVoteByKey = helpers.upsertByKey;
export const getAllPollVotesChunked = helpers.getAllChunked;
export const listPollVotesPage = helpers.listPage;
