import { z } from 'zod';
import { createNodeHelpers } from './base';

export const CHANNELS_COLLECTION = 'channels';

export const channelSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  kind: z.enum(['group', 'direct']).default('group'),
  directUserOrganizationKey: z.string().cuid().optional(),
  directOrchestratorKey: z.string().cuid().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  embedding: z.array(z.number().finite()).default([]),
}).superRefine((channel, ctx) => {
  const hasDirectPair = Boolean(channel.directUserOrganizationKey) && Boolean(channel.directOrchestratorKey);
  if ((channel.kind === 'direct') !== hasDirectPair) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: 'Direct channels require both direct identities; group channels permit neither' });
  }
});

export type Channel = z.infer<typeof channelSchema>;
export const channelsEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(CHANNELS_COLLECTION, channelSchema, channelsEmbeddingFields);
export const insertChannel = helpers.insert;
export const getChannelById = helpers.getById;
export const updateChannel = helpers.updateById;
export const deleteChannel = helpers.deleteById;
export const upsertChannelByKey = helpers.upsertByKey;
export const getAllChannelsChunked = helpers.getAllChunked;
export const listChannelsPage = helpers.listPage;
