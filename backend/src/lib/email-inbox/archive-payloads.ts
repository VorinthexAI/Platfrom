import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { chunkDocumentContent, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { inboxCategorySchema } from './classification';

const key = z.string().cuid();
const text = z.string().trim().min(1);
const address = z.string().email();
export const emailArchiveDocumentSchema = documentSchema;

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
  unread: z.boolean().default(false),
  starred: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  latestFrom: address.optional(),
  inInbox: z.boolean().optional(),
  isFavorite: z.boolean().default(false),
  embeddingContentVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  inboxCategory: inboxCategorySchema.default('Important'),
}).strict();

const messageDataSchema = z.object({
  accountKey: key,
  threadKey: key,
  providerMessageId: text,
  from: address,
  fromName: z.string().trim().min(1).max(320).optional(),
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
  unread: z.boolean().default(false),
  direction: z.enum(['inbound', 'outbound']),
  sentAt: z.string().datetime(),
  hasAttachments: z.boolean(),
  attachments: emailAttachmentRefsSchema.optional(),
  embeddingContentVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  inboxCategory: inboxCategorySchema.default('Important'),
}).strict();

const draftCommonSchema = z.object({
  generatedContent: text,
  finalContent: z.string().max(50_000).optional(),
  providerMessageId: text.optional(),
  sendStartedAt: z.string().datetime().optional(),
  sendLeaseToken: z.string().uuid().optional(),
  status: z.enum(['generated', 'edited', 'sending', 'sent', 'discarded']),
  tone: z.string().trim().min(1).max(255).optional(),
  instruction: z.string().trim().max(1_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
}).strict();

const replyDraftDataSchema = draftCommonSchema.extend({
  variant: z.literal('reply').default('reply'),
  replyMode: z.enum(['reply', 'reply_all']).default('reply'),
  threadKey: key,
  messageKey: key,
  to: z.array(address).max(50).default([]),
  cc: z.array(address).max(50).default([]),
  emailWritingProfileKey: key.optional(),
}).strict();

const newDraftDataSchema = draftCommonSchema.extend({
  variant: z.literal('new'),
  accountKey: key,
  to: z.array(address).min(1).max(50),
  cc: z.array(address).max(50).optional(),
  bcc: z.array(address).max(50).optional(),
  subject: z.string().max(998),
}).strict();

export const emailToneDataSchema = z.object({
  identifier: z.string().trim().min(1).max(255).optional(),
  slug: z.enum(['casual', 'formal', 'concise', 'warm', 'direct']).optional(),
  name: text.max(255),
  instruction: text.max(20_000),
}).strict();
const legacyEmailToneDataSchema = emailToneDataSchema.extend({ description: text.max(10_000).optional() }).strict();
const legacyEmailTonePayloadSchema = envelope('mail-tone', legacyEmailToneDataSchema);

export const emailReplyContextDataSchema = z.object({
  name: text.max(255),
  text: text.max(4_000),
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
export const emailTonePayloadSchema = envelope('mail-tone', emailToneDataSchema);
export const emailReplyContextPayloadSchema = envelope('mail-reply-context', emailReplyContextDataSchema);
export const emailWritingProfilePayloadSchema = envelope('mail-writing-profile', writingProfileDataSchema);
export const emailContactPayloadSchema = envelope('mail-contact', contactDataSchema);
export const emailRulePayloadSchema = envelope('mail-rule', ruleDataSchema);
export const emailArchivePayloadSchema = z.discriminatedUnion('kind', [emailThreadPayloadSchema, emailMessagePayloadSchema, emailReplyDraftPayloadSchema, emailNewDraftPayloadSchema, emailTonePayloadSchema, emailReplyContextPayloadSchema, emailWritingProfilePayloadSchema, emailContactPayloadSchema, emailRulePayloadSchema]);

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
export type EmailTone = ArchiveRecord<z.infer<typeof emailToneDataSchema>> & { isFavorite: boolean };
export type EmailReplyContext = ArchiveRecord<z.infer<typeof emailReplyContextDataSchema>>;
export type EmailWritingProfile = ArchiveRecord<z.infer<typeof writingProfileDataSchema>>;
export type EmailContact = ArchiveRecord<z.infer<typeof contactDataSchema>>;
export type EmailRule = ArchiveRecord<z.infer<typeof ruleDataSchema>>;

export function emailMessageSemanticText(message: Pick<EmailMessage, 'from' | 'subject' | 'body'>) {
  return `${message.from.trim().toLowerCase()}\n\n${message.subject.replace(/\s+/g, ' ').trim()}\n\n${message.body.replace(/\r\n?/g, '\n').trim()}`;
}

export function encodeArchivePayload(payload: unknown) {
  return JSON.stringify(emailArchivePayloadSchema.parse(payload));
}

function decode<Data>(document: unknown, schema: z.ZodTypeAny): ArchiveRecord<Data> {
  const parsedDocument = emailArchiveDocumentSchema.parse(document);
  const payload = schema.parse(JSON.parse(parsedDocument.content)) as { data: Data };
  return { ...payload.data, key: parsedDocument.key, scopeKey: parsedDocument.scopeKey, embedding: parsedDocument.embedding, createdAt: parsedDocument.createdAt, updatedAt: parsedDocument.updatedAt };
}

export const decodeEmailThread = (document: unknown) => decode<z.infer<typeof threadDataSchema>>(document, emailThreadPayloadSchema);
export const decodeEmailMessage = (document: unknown) => decode<z.infer<typeof messageDataSchema>>(document, emailMessagePayloadSchema);
export const decodeEmailDraft = (document: unknown) => decode<z.infer<typeof replyDraftDataSchema> | z.infer<typeof newDraftDataSchema>>(document, emailDraftPayloadSchema);
export const decodeEmailReplyContext = (document: unknown) => decode<z.infer<typeof emailReplyContextDataSchema>>(document, emailReplyContextPayloadSchema);
export function encodeEmailToneContent(tone: z.input<typeof emailToneDataSchema>) {
  const value = emailToneDataSchema.parse(tone);
  return `# ${value.name}\n\n<!-- vorinthex-mail-tone ${JSON.stringify({ version: 1, ...(value.identifier ? { identifier: value.identifier } : {}), ...(value.slug ? { slug: value.slug } : {}) })} -->\n\n## Instruction\n\n${value.instruction}`;
}

export function decodeEmailToneContent(content: string) {
  const match = /^# ([^\n]+)\n\n<!-- vorinthex-mail-tone (\{[^\n]+\}) -->\n\n(?:[\s\S]*?\n\n)?## Instruction\n\n([\s\S]+)$/u.exec(content.trim());
  if (!match) throw new Error('Invalid editable email tone document');
  const { version: _version, ...metadata } = z.object({ version: z.literal(1), identifier: emailToneDataSchema.shape.identifier, slug: emailToneDataSchema.shape.slug }).strict().parse(JSON.parse(match[2]!));
  return emailToneDataSchema.parse({ ...metadata, name: match[1]!.trim(), instruction: match[3]!.trim() });
}

export function emailToneSemanticText(tone: Pick<z.infer<typeof emailToneDataSchema>, 'name'>) {
  return tone.name;
}

export function prepareEmailToneDocument(document: Document, tone: z.infer<typeof emailToneDataSchema>, embedding: z.input<typeof currentEmbeddingSchema>) {
  const semanticText = emailToneSemanticText(tone);
  const contentChunks = chunkDocumentContent(semanticText);
  const value = emailArchiveDocumentSchema.extend({ emailToneEmbeddingVersion: z.literal(1) }).parse({
    ...document,
    embedding,
    contentChunks,
    chunkEmbeddings: contentChunks.map(() => embedding),
    semanticChunkCount: contentChunks.length,
    semanticContentHash: documentSemanticHash(semanticText),
    emailToneEmbeddingVersion: 1,
  });
  decodeEmailToneContent(value.content);
  return value;
}

export function emailReplyContextSemanticText(note: Pick<z.infer<typeof emailReplyContextDataSchema>, 'name' | 'text'>) {
  return `${note.name}\n\n${note.text}`;
}

export function prepareEmailReplyContextDocument(document: Document, note: z.infer<typeof emailReplyContextDataSchema>, embedding: z.input<typeof currentEmbeddingSchema>) {
  const semanticText = emailReplyContextSemanticText(note);
  const contentChunks = chunkDocumentContent(semanticText);
  const value = emailArchiveDocumentSchema.extend({ emailReplyContextEmbeddingVersion: z.literal(1) }).parse({
    ...document,
    embedding,
    contentChunks,
    chunkEmbeddings: contentChunks.map(() => embedding),
    semanticChunkCount: contentChunks.length,
    semanticContentHash: documentSemanticHash(semanticText),
    emailReplyContextEmbeddingVersion: 1,
  });
  decodeEmailReplyContext(value);
  return value;
}

export function decodeEmailTone(document: unknown): EmailTone {
  const parsedDocument = emailArchiveDocumentSchema.parse(document);
  try {
    return { ...decode<z.infer<typeof emailToneDataSchema>>(parsedDocument, emailTonePayloadSchema), isFavorite: parsedDocument.isFavorite };
  } catch {
    let data: z.infer<typeof emailToneDataSchema>;
    try {
      const legacy = decode<z.infer<typeof legacyEmailToneDataSchema>>(parsedDocument, legacyEmailTonePayloadSchema);
      data = emailToneDataSchema.parse({ identifier: legacy.identifier, slug: legacy.slug, name: legacy.name, instruction: legacy.instruction });
    } catch {
      data = decodeEmailToneContent(parsedDocument.content);
    }
    return { ...data, key: parsedDocument.key, scopeKey: parsedDocument.scopeKey, embedding: parsedDocument.embedding, isFavorite: parsedDocument.isFavorite, createdAt: parsedDocument.createdAt, updatedAt: parsedDocument.updatedAt };
  }
}
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
  mutationPolicy?: 'user' | 'system-only';
  developmentFixtureIdentifier?: string;
}): Document {
  const { mutationPolicy = 'system-only', ...document } = input;
  return documentSchema.parse({ ...document, content: JSON.stringify(document.payload), mutationPolicy, isFavorite: false });
}
