import { z } from 'zod';

export const PLACE_HERO_MEDIA_COLLECTION = 'placeHeroMedia';

export const placeHeroMediaSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  placeKey: z.string().cuid(),
  storageKey: z.string().trim().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal('image/png'),
  sizeBytes: z.number().int().positive(),
  width: z.literal(1536),
  height: z.literal(1024),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type PlaceHeroMedia = z.infer<typeof placeHeroMediaSchema>;
