import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_THREADS_COLLECTION = 'emailThreads';
const text = z.string().trim().min(1);
export const emailThreadSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), accountKey: z.string().cuid(), providerThreadId: text, subject: text, summary: text, intent: text, action: text.optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']), state: z.enum(['needs_action', 'waiting', 'informational', 'filtered', 'done']), lastMessageAt: z.string().datetime(),
  snippet: z.string().optional(), category: z.enum(['primary', 'updates', 'promotions', 'social', 'forums', 'other']).optional(), unread: z.boolean().optional(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(),
  latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean().default(false),
  embedding: currentEmbeddingSchema, embeddingContentVersion: z.literal(2).optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailThread = z.infer<typeof emailThreadSchema>;
export const emailThreadsEmbeddingFields = ['subject', 'summary', 'intent', 'action'] as const;
const helpers = createNodeHelpers(EMAIL_THREADS_COLLECTION, emailThreadSchema, emailThreadsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailThread = helpers.insert;
export const getEmailThreadById = helpers.getById;
export const updateEmailThread = helpers.updateById;
export const deleteEmailThread = helpers.deleteById;
export const upsertEmailThreadByKey = helpers.upsertByKey;
export const getAllEmailThreadsChunked = helpers.getAllChunked;
export const listEmailThreadsPage = helpers.listPage;
