import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_WRITING_PROFILES_COLLECTION = 'emailWritingProfiles';
const text = z.string().trim().min(1);
export const emailWritingProfileSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: text, description: text, tone: text, style: text, structure: text, vocabulary: text, conventions: text,
  embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailWritingProfile = z.infer<typeof emailWritingProfileSchema>;
export const emailWritingProfilesEmbeddingFields = ['name', 'description', 'tone', 'style', 'structure', 'vocabulary', 'conventions'] as const;
const helpers = createNodeHelpers(EMAIL_WRITING_PROFILES_COLLECTION, emailWritingProfileSchema, emailWritingProfilesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailWritingProfile = helpers.insert;
export const getEmailWritingProfileById = helpers.getById;
export const updateEmailWritingProfile = helpers.updateById;
export const deleteEmailWritingProfile = helpers.deleteById;
export const upsertEmailWritingProfileByKey = helpers.upsertByKey;
export const getAllEmailWritingProfilesChunked = helpers.getAllChunked;
export const listEmailWritingProfilesPage = helpers.listPage;
