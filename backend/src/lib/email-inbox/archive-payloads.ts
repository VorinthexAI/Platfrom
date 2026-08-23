import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { documentSchema, type Document } from '@/lib/db/documents.node';

const key = z.string().cuid();
const text = z.string().trim().min(1);
const address = z.string().email();

export const emailAttachmentRefSchema = z.object({
  type: z.enum(['document', 'image']),
  key,
}).strict();
export const emailAttachmentRefsSchema = z.array(emailAttachmentRefSchema).max(20);
export type EmailAttachmentRef = z.infer<typeof emailAttachmentRefSchema>;

const threadDataSchema = z.object({
  accountKey: key,
  providerThreadId: text,
  subject: text,
  summary: text,
  intent: text,
  action: text.optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  state: z.enum(['needs_action', 'waiting', 'informational', 'filtered', 'done']),
  lastMessageAt: z.string().datetime(),
  snippet: z.string().optional(),
  category: z.enum(['primary', 'updates', 'promotions', 'social', 'forums', 'other']).optional(),
  unread: z.boolean().optional(),
  starred: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  latestFrom: address.optional(),
  inInbox: z.boolean().optional(),
  isFavorite: z.boolean().default(false),
  embeddingContentVersion: z.literal(2).optional(),
}).strict();

const messageDataSchema = z.object({
  accountKey: key,
  threadKey: key,
  providerMessageId: text,
  from: address,
  to: z.array(address),
  cc: z.array(address).optional(),
  bcc: z.array(address).optional(),
  subject: text,
  body: text,
  summary: text,
  bodyHtml: z.string().optional(),
  replyTo: address.optional(),
  messageIdHeader: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  parentMessageId: z.string().optional(),
  replyDepth: z.number().int().nonnegative().default(0),
  labels: z.array(z.string()).optional(),
  unread: z.boolean().optional(),
  direction: z.enum(['inbound', 'outbound']),
  sentAt: z.string().datetime(),
  hasAttachments: z.boolean(),
  attachments: emailAttachmentRefsSchema.optional(),
  embeddingContentVersion: z.literal(2).optional(),
}).strict();

const draftCommonSchema = z.object({
  generatedContent: text,
  finalContent: text.optional(),
  providerMessageId: text.optional(),
  sendStartedAt: z.string().datetime().optional(),
  sendLeaseToken: z.string().uuid().optional(),
  status: z.enum(['generated', 'edited', 'sending', 'sent', 'discarded']),
  tone: z.enum(['concise', 'warm', 'formal', 'direct']).optional(),
  instruction: z.string().trim().max(1_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
}).strict();

const replyDraftDataSchema = draftCommonSchema.extend({
  variant: z.literal('reply').default('reply'),
  threadKey: key,
  messageKey: key,
  emailWritingProfileKey: key.optional(),
}).strict();

const newDraftDataSchema = draftCommonSchema.extend({
  variant: z.literal('new'),
  accountKey: key,
  to: z.array(address).min(1).max(50),
  cc: z.array(address).max(50).optional(),
  bcc: z.array(address).max(50).optional(),
  subject: text.max(998),
}).strict();

const toneDataSchema = z.object({
  slug: z.enum(['concise', 'warm', 'formal', 'direct']),
  name: z.enum(['Concise', 'Warm', 'Formal', 'Direct']),
  description: text,
  instruction: text,
}).strict();

const writingProfileDataSchema = z.object({
  name: text,
  description: text,
  tone: text,
  style: text,
  structure: text,
  vocabulary: text,
  conventions: text,
}).strict();

const contactDataSchema = z.object({
  email: address,
  name: text.optional(),
  relationship: text.optional(),
  context: text.optional(),
  emailWritingProfileKey: key.optional(),
}).strict();

const ruleDataSchema = z.object({
  name: text,
  description: text,
  condition: text,
  instruction: text,
  action: z.enum(['prioritize', 'filter', 'draft_reply', 'auto_reply']),
  config: z.record(z.string(), z.unknown()),
  isEnabled: z.boolean(),
}).strict();

function envelope<Kind extends string, Schema extends z.ZodTypeAny>(kind: Kind, data: Schema) {
  return z.object({ version: z.literal(1), kind: z.literal(kind), data }).strict();
}

export const emailThreadPayloadSchema = envelope('mail-thread', threadDataSchema);
export const emailMessagePayloadSchema = envelope('mail-message', messageDataSchema);
const emailReplyDraftPayloadSchema = envelope('mail-reply-draft', replyDraftDataSchema);
const emailNewDraftPayloadSchema = envelope('mail-new-draft', newDraftDataSchema);
export const emailDraftPayloadSchema = z.discriminatedUnion('kind', [
  emailReplyDraftPayloadSchema,
  emailNewDraftPayloadSchema,
]);
export const emailTonePayloadSchema = envelope('mail-tone', toneDataSchema);
export const emailWritingProfilePayloadSchema = envelope('mail-writing-profile', writingProfileDataSchema);
export const emailContactPayloadSchema = envelope('mail-contact', contactDataSchema);
export const emailRulePayloadSchema = envelope('mail-rule', ruleDataSchema);
export const emailArchivePayloadSchema = z.discriminatedUnion('kind', [emailThreadPayloadSchema, emailMessagePayloadSchema, emailReplyDraftPayloadSchema, emailNewDraftPayloadSchema, emailTonePayloadSchema, emailWritingProfilePayloadSchema, emailContactPayloadSchema, emailRulePayloadSchema]);

type ArchiveRecord<Data> = Data & {
  key: string;
  scopeKey: string;
  embedding: number[];
  createdAt: string;
  updatedAt: string;
};
export type EmailThread = ArchiveRecord<z.infer<typeof threadDataSchema>>;
export type EmailMessage = ArchiveRecord<z.infer<typeof messageDataSchema>>;
export type EmailDraft = ArchiveRecord<z.infer<typeof replyDraftDataSchema> | z.infer<typeof newDraftDataSchema>>;
export type EmailDraftCreate = (z.infer<typeof replyDraftDataSchema> | z.infer<typeof newDraftDataSchema>) & { scopeKey: string; embedding: number[] };
export type EmailTone = ArchiveRecord<z.infer<typeof toneDataSchema>>;
export type EmailWritingProfile = ArchiveRecord<z.infer<typeof writingProfileDataSchema>>;
export type EmailContact = ArchiveRecord<z.infer<typeof contactDataSchema>>;
export type EmailRule = ArchiveRecord<z.infer<typeof ruleDataSchema>>;

export function encodeArchivePayload(payload: unknown) {
  return JSON.stringify(emailArchivePayloadSchema.parse(payload));
}

function decode<Data>(document: unknown, schema: z.ZodTypeAny): ArchiveRecord<Data> {
  const parsedDocument = documentSchema.parse(document);
  const payload = schema.parse(JSON.parse(parsedDocument.content)) as { data: Data };
  return { ...payload.data, key: parsedDocument.key, scopeKey: parsedDocument.scopeKey, embedding: parsedDocument.embedding, createdAt: parsedDocument.createdAt, updatedAt: parsedDocument.updatedAt };
}

export const decodeEmailThread = (document: unknown) => decode<z.infer<typeof threadDataSchema>>(document, emailThreadPayloadSchema);
export const decodeEmailMessage = (document: unknown) => decode<z.infer<typeof messageDataSchema>>(document, emailMessagePayloadSchema);
export const decodeEmailDraft = (document: unknown) => decode<z.infer<typeof replyDraftDataSchema> | z.infer<typeof newDraftDataSchema>>(document, emailDraftPayloadSchema);
export const decodeEmailTone = (document: unknown) => decode<z.infer<typeof toneDataSchema>>(document, emailTonePayloadSchema);
export const decodeEmailWritingProfile = (document: unknown) => decode<z.infer<typeof writingProfileDataSchema>>(document, emailWritingProfilePayloadSchema);
export const decodeEmailContact = (document: unknown) => decode<z.infer<typeof contactDataSchema>>(document, emailContactPayloadSchema);
export const decodeEmailRule = (document: unknown) => decode<z.infer<typeof ruleDataSchema>>(document, emailRulePayloadSchema);

export function archiveDocument(input: {
  key: string;
  scopeKey: string;
  folderKey: string;
  name: string;
  payload: unknown;
  embedding: z.input<typeof currentEmbeddingSchema>;
  createdAt: string;
  updatedAt: string;
}): Document {
  return documentSchema.parse({ ...input, content: JSON.stringify(input.payload), mutationPolicy: 'system-only', isFavorite: false });
}
