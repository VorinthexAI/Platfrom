import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_MESSAGES_COLLECTION = 'emailMessages';
const address = z.string().email();
const text = z.string().trim().min(1);
export const emailMessageSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), accountKey: z.string().cuid(), threadKey: z.string().cuid(), providerMessageId: text,
  from: address, to: z.array(address), cc: z.array(address).optional(), bcc: z.array(address).optional(), subject: text, body: text, summary: text,
  direction: z.enum(['inbound', 'outbound']), sentAt: z.string().datetime(), hasAttachments: z.boolean(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export const emailMessagesEmbeddingFields = ['subject', 'body', 'summary'] as const;
const helpers = createNodeHelpers(EMAIL_MESSAGES_COLLECTION, emailMessageSchema, emailMessagesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailMessage = helpers.insert;
export const getEmailMessageById = helpers.getById;
export const updateEmailMessage = helpers.updateById;
export const deleteEmailMessage = helpers.deleteById;
export const upsertEmailMessageByKey = helpers.upsertByKey;
export const getAllEmailMessagesChunked = helpers.getAllChunked;
export const listEmailMessagesPage = helpers.listPage;
