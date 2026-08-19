import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const VISUAL_IDENTITIES_COLLECTION = 'visualIdentities';
export const visualIdentitySchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(12_000),
  referenceImageKey: z.string().cuid(),
  embedding: currentEmbeddingSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VisualIdentity = z.infer<typeof visualIdentitySchema>;

const helpers = createNodeHelpers(VISUAL_IDENTITIES_COLLECTION, visualIdentitySchema, ['name', 'description'], { includeEmbeddingMetadata: false });
export const insertVisualIdentity = helpers.insert;
export const getVisualIdentityById = helpers.getById;
export const updateVisualIdentity = helpers.updateById;
