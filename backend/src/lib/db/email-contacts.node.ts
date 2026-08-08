import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_CONTACTS_COLLECTION = 'emailContacts';
const optionalText = z.string().trim().min(1).optional();
export const emailContactSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), email: z.string().email(), name: optionalText, relationship: optionalText, context: optionalText,
  emailWritingProfileKey: z.string().cuid().optional(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine((contact, context) => {
  if (!contact.name && !contact.relationship && !contact.context) context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one semantic contact field is required.' });
});
export type EmailContact = z.infer<typeof emailContactSchema>;
export const emailContactsEmbeddingFields = ['name', 'relationship', 'context'] as const;
const helpers = createNodeHelpers(EMAIL_CONTACTS_COLLECTION, emailContactSchema, emailContactsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailContact = helpers.insert;
export const getEmailContactById = helpers.getById;
export const updateEmailContact = helpers.updateById;
export const deleteEmailContact = helpers.deleteById;
export const upsertEmailContactByKey = helpers.upsertByKey;
export const getAllEmailContactsChunked = helpers.getAllChunked;
export const listEmailContactsPage = helpers.listPage;
