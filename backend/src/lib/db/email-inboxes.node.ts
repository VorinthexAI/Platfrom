import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const EMAIL_INBOXES_COLLECTION = 'emailInboxes';
export const emailInboxEmbeddingFields = ['name', 'description'] as const;
export const emailInboxSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  connectorKey: z.string().cuid(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  coverImageKey: z.string().cuid().optional(),
  isFavorite: z.boolean(),
  embedding: currentEmbeddingSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type EmailInbox = z.infer<typeof emailInboxSchema>;
