import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_REPLY_DRAFTS_COLLECTION = 'emailReplyDrafts';
const text = z.string().trim().min(1);
export const emailReplyDraftSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), threadKey: z.string().cuid(), messageKey: z.string().cuid(), emailWritingProfileKey: z.string().cuid().optional(),
  generatedContent: text, finalContent: text.optional(), status: z.enum(['generated', 'edited', 'sent', 'discarded']), embedding: currentEmbeddingSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailReplyDraft = z.infer<typeof emailReplyDraftSchema>;
export const emailReplyDraftsEmbeddingFields = ['generatedContent', 'finalContent'] as const;
const helpers = createNodeHelpers(EMAIL_REPLY_DRAFTS_COLLECTION, emailReplyDraftSchema, emailReplyDraftsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailReplyDraft = helpers.insert;
export const getEmailReplyDraftById = helpers.getById;
export const updateEmailReplyDraft = helpers.updateById;
export const deleteEmailReplyDraft = helpers.deleteById;
export const upsertEmailReplyDraftByKey = helpers.upsertByKey;
export const getAllEmailReplyDraftsChunked = helpers.getAllChunked;
export const listEmailReplyDraftsPage = helpers.listPage;
