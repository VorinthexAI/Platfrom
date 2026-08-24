import { z } from 'zod';
import { rolloutEmbeddingSchema } from '@/lib/embeddings';
import { TRIP_EMBEDDING_CONTENT_VERSION } from '@/lib/travel/semantic-text';

export const TRIPS_COLLECTION = 'trips';
export const tripSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  status: z.enum(['planned', 'completed']).default('planned'),
  isFavorite: z.boolean().default(false),
  coverImageKey: z.string().cuid().optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  embedding: rolloutEmbeddingSchema.optional(),
  embeddingContentVersion: z.literal(TRIP_EMBEDDING_CONTENT_VERSION).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
}).superRefine((trip, context) => {
  if ((trip.embedding === undefined) !== (trip.embeddingContentVersion === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Trip embedding and content version must be persisted together.' });
});
export type Trip = z.infer<typeof tripSchema>;
