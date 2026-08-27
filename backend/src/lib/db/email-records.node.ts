import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import {
  emailMessageDataSchema,
  emailNewDraftBaseDataSchema,
  emailReplyContextDataSchema,
  emailReplyDraftDataSchema,
  emailThreadDataSchema,
  emailToneDataSchema,
  emailWritingProfileDataSchema,
} from '@/lib/email-inbox/archive-payloads';

const keySchema = z.string().cuid();
const timestampsSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
const canonicalRecordSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  embedding: currentEmbeddingSchema,
  developmentFixtureIdentifier: z.string().trim().min(1).optional(),
  createdAt: timestampsSchema.shape.createdAt,
  updatedAt: timestampsSchema.shape.updatedAt,
}).strict();

export const EMAIL_THREADS_COLLECTION = 'emailThreads';
export const EMAIL_MESSAGES_COLLECTION = 'emailMessages';
export const EMAIL_DRAFTS_COLLECTION = 'emailDrafts';
export const EMAIL_TONES_COLLECTION = 'emailTones';
export const EMAIL_REPLY_CONTEXT_COLLECTION = 'emailReplyContext';
export const EMAIL_WRITING_PROFILES_COLLECTION = 'emailWritingProfiles';

export const emailThreadRecordSchema = canonicalRecordSchema.extend(emailThreadDataSchema.shape).strict();
export const emailMessageRecordSchema = canonicalRecordSchema.extend(emailMessageDataSchema.shape).strict();
export const emailDraftRecordSchema = z.union([
  canonicalRecordSchema.extend(emailReplyDraftDataSchema.shape).strict(),
  canonicalRecordSchema.extend(emailNewDraftBaseDataSchema.shape).strict(),
]);
export const emailToneRecordSchema = canonicalRecordSchema.extend(emailToneDataSchema.shape).extend({ isFavorite: z.boolean().default(false) }).strict();
export const emailReplyContextRecordSchema = canonicalRecordSchema.extend(emailReplyContextDataSchema.shape).strict();
export const emailWritingProfileRecordSchema = canonicalRecordSchema.extend(emailWritingProfileDataSchema.shape).strict();

export type EmailThreadRecord = z.infer<typeof emailThreadRecordSchema>;
export type EmailMessageRecord = z.infer<typeof emailMessageRecordSchema>;
export type EmailDraftRecord = z.infer<typeof emailDraftRecordSchema>;
export type EmailToneRecord = z.infer<typeof emailToneRecordSchema>;
export type EmailReplyContextRecord = z.infer<typeof emailReplyContextRecordSchema>;
export type EmailWritingProfileRecord = z.infer<typeof emailWritingProfileRecordSchema>;
