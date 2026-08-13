import { z } from 'zod';
import { createNodeHelpers } from './base';

export const IMAGE_IDENTITIES_COLLECTION = 'imageIdentities';
export const imageIdentitySchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  imageKey: z.string().cuid(),
  identityKey: z.string().cuid(),
  confidence: z.number().min(-1).max(1),
  isReference: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type ImageIdentity = z.infer<typeof imageIdentitySchema>;

const helpers = createNodeHelpers(IMAGE_IDENTITIES_COLLECTION, imageIdentitySchema, [], { requireEmbedding: false });
export const insertImageIdentity = helpers.insert;
export const getImageIdentityById = helpers.getById;
