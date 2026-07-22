import { z } from 'zod';
import { createNodeHelpers } from './base';

export const CHANNELS_COLLECTION = 'channels';

export const channelSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
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
