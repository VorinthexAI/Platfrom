import { z } from 'zod';
import { createNodeHelpers } from './base';
import { communicationChannelKeySchema } from './communication-keys';

export const CHANNEL_PARTICIPANTS_COLLECTION = 'channelParticipants';

export const channelParticipantSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  channelKey: communicationChannelKeySchema,
  userOrganizationKey: z.string().trim().min(1).max(160).optional(),
  orchestratorKey: z.string().trim().min(1).max(160).optional(),
  lastReadMessageKey: z.string().cuid().optional(),
  joinedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
}).superRefine((participant, ctx) => {
  if (Boolean(participant.userOrganizationKey) === Boolean(participant.orchestratorKey)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userOrganizationKey'], message: 'Exactly one participant identity is required' });
  }
});

export type ChannelParticipant = z.infer<typeof channelParticipantSchema>;
export const channelParticipantsEmbeddingFields = [] as const;
const helpers = createNodeHelpers(CHANNEL_PARTICIPANTS_COLLECTION, channelParticipantSchema, channelParticipantsEmbeddingFields);
export const insertChannelParticipant = helpers.insert;
export const getChannelParticipantById = helpers.getById;
export const updateChannelParticipant = helpers.updateById;
export const deleteChannelParticipant = helpers.deleteById;
export const upsertChannelParticipantByKey = helpers.upsertByKey;
export const getAllChannelParticipantsChunked = helpers.getAllChunked;
export const listChannelParticipantsPage = helpers.listPage;
