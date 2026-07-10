import { z } from 'zod';
import { createNodeHelpers } from './base';

export const VOICES_COLLECTION = 'voices';

export const voiceSchema = z.object({
  key: z.string(),
  provider: z.string(),
  model: z.string(),
  modelLabel: z.string(),
  voice: z.string(),
  language: z.string(),
  format: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Voice = z.infer<typeof voiceSchema>;

export const voicesEmbedKeys = z.enum(['voice', 'modelLabel', 'language']);

const helpers = createNodeHelpers(VOICES_COLLECTION, voiceSchema, voicesEmbedKeys.options);

export const insertVoice = helpers.insert;
export const getVoiceById = helpers.getById;
export const updateVoice = helpers.updateById;
export const deleteVoice = helpers.deleteById;
export const upsertVoiceByKey = helpers.upsertByKey;
export const getAllVoicesChunked = helpers.getAllChunked;
export const listVoicesPage = helpers.listPage;
