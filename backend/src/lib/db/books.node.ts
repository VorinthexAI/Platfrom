import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOKS_COLLECTION = 'books';
export const bookStatusSchema = z.enum(['queued', 'planning', 'researching', 'writing', 'finalizing', 'narrating', 'ready', 'failed', 'cancelled']);
export const bookGenerationStageSchema = z.enum(['accepted', 'outline', 'research', 'draft', 'continuity', 'audio', 'art', 'publish', 'complete']);
export const bookNarratorVoiceSchema = z.enum(['calm', 'clear', 'warm']);
export const bookNarrationPaceSchema = z.number().min(0.75).max(2);
export const bookGenerationInputSchema = z.object({
  topic: z.string().trim().min(3).max(2_000), goal: z.string().trim().min(3).max(2_000), currentKnowledge: z.string().trim().min(2).max(2_000),
  writingTone: z.string().trim().min(2).max(200), chapterCount: z.union([z.literal(10), z.literal(25), z.literal(50)]), language: z.string().trim().min(2).max(100),
  archiveDocumentKeys: z.array(z.string().cuid()).max(50), narratorVoiceKey: bookNarratorVoiceSchema, narrationPace: bookNarrationPaceSchema, chapterImages: z.boolean(), additionalInstructions: z.string().trim().max(12_000).optional(),
}).strict();
export const bookSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), title: z.string().trim().min(1), subtitle: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1), goal: z.string().trim().min(1), audience: z.string().trim().min(1), outcome: z.string().trim().min(1), narratorVoiceKey: bookNarratorVoiceSchema.optional(), narrationPace: bookNarrationPaceSchema.optional(),
  language: z.string().trim().min(1), generationRequestKey: z.string().trim().min(1).max(200).optional(), generationBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), generationInput: bookGenerationInputSchema.optional(), generationOwnerKey: z.string().cuid().optional(),
  generationStage: bookGenerationStageSchema.default('accepted'), generationCompletedUnits: z.number().int().nonnegative().default(0), generationTotalUnits: z.number().int().nonnegative().default(0), generationAttempt: z.number().int().nonnegative().default(0), generationError: z.string().trim().min(1).max(4_000).optional(), cancelRequestedAt: z.string().datetime().optional(),
  generationLeaseToken: z.string().trim().min(1).max(200).optional(), generationLeaseExpiresAt: z.string().datetime().optional(), coverStorageKey: z.string().trim().min(1).optional(), coverInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), estimatedMinutes: z.number().int().nonnegative().default(0),
  chapterCount: z.number().int().nonnegative().default(0), isFavorite: z.boolean().default(false), status: bookStatusSchema, embedding: currentEmbeddingSchema,
  archiveFolderKey: z.string().cuid().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Book = z.infer<typeof bookSchema>;
export const booksEmbeddingFields = ['title', 'subtitle', 'description', 'goal', 'audience', 'outcome'] as const;
const helpers = createNodeHelpers(BOOKS_COLLECTION, bookSchema, booksEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBook = helpers.insert;
export const getBookById = helpers.getById;
export const updateBook = helpers.updateById;
export const deleteBook = helpers.deleteById;
export const upsertBookByKey = helpers.upsertByKey;
export const getAllBooksChunked = helpers.getAllChunked;
export const listBooksPage = helpers.listPage;
