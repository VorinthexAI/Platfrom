import { z } from 'zod';
import { currentEmbeddingBatchSchema, currentEmbeddingSchema } from '@/lib/embeddings';
import { documentContentChunksSchema } from '@/lib/ai/document-processing/chunking';

export const PLACE_REFERENCES_COLLECTION = 'placeReferences';
export const placeReferenceKindSchema = z.enum(['brief', 'accommodations', 'restaurants', 'activities']);

export const placeReferenceSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  placeKey: z.string().cuid(),
  kind: placeReferenceKindSchema,
  name: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(4_000),
  embedding: currentEmbeddingSchema,
  contentChunks: documentContentChunksSchema,
  chunkEmbeddings: currentEmbeddingBatchSchema,
  semanticChunkCount: z.number().int().positive(),
  semanticContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type PlaceReference = z.infer<typeof placeReferenceSchema>;
