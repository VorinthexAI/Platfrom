import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { chunkDocumentContent, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import type { PreparedDocumentRepresentation } from '@/lib/ai/document-processing';
import { inboxCategorySchema } from './classification';

const key = z.string().cuid();
const text = z.string().trim().min(1);
const address = z.string().email();
export const emailArchiveDocumentSchema = documentSchema;

export const emailAttachmentRefSchema = z.object({
  type: z.enum(['document', 'image']),
  key,
}).strict();
export const emailAttachmentRefsSchema = z.array(emailAttachmentRefSchema).max(20)
  .refine((refs) => new Set(refs.map(({ type, key }) => `${type}:${key}`)).size === refs.length, 'Attachment references must be distinct');
export type EmailAttachmentRef = z.infer<typeof emailAttachmentRefSchema>;
export const emailAttachmentAvailabilitySchema = z.enum(['none', 'complete', 'truncated', 'failed']);

export const emailThreadDataSchema = z.object({
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
  embeddingContentVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  inboxCategory: inboxCategorySchema.default('Important'),
}).strict();

export const emailMessageDataSchema = z.object({
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
  attachmentAvailability: emailAttachmentAvailabilitySchema.default('none'),
  unavailableAttachmentCount: z.number().int().min(1).max(10_000).optional(),
  attachments: emailAttachmentRefsSchema.optional(),
  embeddingContentVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
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

export const emailReplyDraftDataSchema = draftCommonSchema.extend({
  creationSource: z.enum(['manual', 'subscription']).default('manual'),
  variant: z.literal('reply').default('reply'),
  replyMode: z.enum(['reply', 'reply_all']).default('reply'),
  threadKey: key,
  messageKey: key,
  to: z.array(address).max(50).default([]),
  cc: z.array(address).max(50).default([]),
  emailWritingProfileKey: key.optional(),
}).strict();

export const emailNewDraftBaseDataSchema = draftCommonSchema.extend({
  creationSource: z.literal('manual').default('manual'),
  variant: z.literal('new'),
  accountKey: key,
  to: z.array(address).min(1).max(50),
  cc: z.array(address).max(50).optional(),
  bcc: z.array(address).max(50).optional(),
  subject: z.string().max(998),
}).strict();
export const emailNewDraftDataSchema = emailNewDraftBaseDataSchema.superRefine((draft, context) => {
  const seen = new Map<string, 'to' | 'cc' | 'bcc'>();
  for (const field of ['to', 'cc', 'bcc'] as const) for (const [index, address] of (draft[field] ?? []).entries()) {
    const normalized = address.trim().toLocaleLowerCase('en-US');
    const previous = seen.get(normalized);
    if (previous) context.addIssue({ code: z.ZodIssueCode.custom, path: [field, index], message: previous === field ? `Duplicate ${field.toUpperCase()} recipient` : `Recipient is already present in ${previous.toUpperCase()}` });
    else seen.set(normalized, field);
  }
});

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

export const emailWritingProfileDataSchema = z.object({
  name: text,
  description: text,
  tone: text,
  style: text,
  structure: text,
  vocabulary: text,
  conventions: text,
}).strict();

export const emailContactDataSchema = z.object({
  email: address,
  name: text.optional(),
  relationship: text.optional(),
  context: text.optional(),
  emailWritingProfileKey: key.optional(),
}).strict();

export const emailRuleDataSchema = z.object({
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

export const emailThreadPayloadSchema = envelope('mail-thread', emailThreadDataSchema);
export const emailMessagePayloadSchema = envelope('mail-message', emailMessageDataSchema);
const emailReplyDraftPayloadSchema = envelope('mail-reply-draft', emailReplyDraftDataSchema);
const emailNewDraftPayloadSchema = envelope('mail-new-draft', emailNewDraftDataSchema);
export const emailDraftPayloadSchema = z.discriminatedUnion('kind', [
  emailReplyDraftPayloadSchema,
  emailNewDraftPayloadSchema,
]);
export const emailTonePayloadSchema = envelope('mail-tone', emailToneDataSchema);
export const emailReplyContextPayloadSchema = envelope('mail-reply-context', emailReplyContextDataSchema);
export const emailWritingProfilePayloadSchema = envelope('mail-writing-profile', emailWritingProfileDataSchema);
export const emailContactPayloadSchema = envelope('mail-contact', emailContactDataSchema);
export const emailRulePayloadSchema = envelope('mail-rule', emailRuleDataSchema);
export const emailArchivePayloadSchema = z.discriminatedUnion('kind', [emailThreadPayloadSchema, emailMessagePayloadSchema, emailReplyDraftPayloadSchema, emailNewDraftPayloadSchema, emailTonePayloadSchema, emailReplyContextPayloadSchema, emailWritingProfilePayloadSchema, emailContactPayloadSchema, emailRulePayloadSchema]);

type ArchiveRecord<Data> = Data & {
  key: string;
  scopeKey: string;
  embedding: number[];
  createdAt: string;
  updatedAt: string;
};
export type EmailThread = ArchiveRecord<z.infer<typeof emailThreadDataSchema>>;
export type EmailMessage = ArchiveRecord<z.infer<typeof emailMessageDataSchema>>;
export type EmailDraft = ArchiveRecord<z.infer<typeof emailReplyDraftDataSchema> | z.infer<typeof emailNewDraftDataSchema>>;
export type EmailDraftCreate = (z.input<typeof emailReplyDraftDataSchema> | z.input<typeof emailNewDraftDataSchema>) & { scopeKey: string; embedding: number[] };
export type EmailTone = ArchiveRecord<z.infer<typeof emailToneDataSchema>> & { isFavorite: boolean };
export type EmailReplyContext = ArchiveRecord<z.infer<typeof emailReplyContextDataSchema>>;
export type EmailWritingProfile = ArchiveRecord<z.infer<typeof emailWritingProfileDataSchema>>;
export type EmailContact = ArchiveRecord<z.infer<typeof emailContactDataSchema>>;
export type EmailRule = ArchiveRecord<z.infer<typeof emailRuleDataSchema>>;

export function emailMessageSemanticText(message: Pick<EmailMessage, 'from' | 'subject' | 'body'>) {
  return `${message.from.trim().toLowerCase()}\n\n${message.subject.replace(/\s+/g, ' ').trim()}\n\n${message.body.replace(/\r\n?/g, '\n').trim()}`;
}

function titledSections(sections: Array<[string, string | undefined]>) {
  return sections.flatMap(([title, value]) => value?.trim() ? [`${title}\n\n${value.trim()}`] : []).join('\n\n');
}

export function emailArchivePayloadContent(payload: unknown) {
  const parsed = emailArchivePayloadSchema.parse(payload);
  switch (parsed.kind) {
    case 'mail-message': return emailMessageSemanticText(parsed.data);
    case 'mail-thread': return titledSections([['Summary', parsed.data.summary], ['Intent', parsed.data.intent], ['Action', parsed.data.action]]);
    case 'mail-reply-draft': return parsed.data.finalContent?.trim() || parsed.data.generatedContent;
    case 'mail-new-draft': return titledSections([['To', parsed.data.to.join(', ')], ['Subject', parsed.data.subject], ['Message', parsed.data.finalContent?.trim() || parsed.data.generatedContent]]);
    case 'mail-tone': return `${parsed.data.name}\n\n${parsed.data.instruction}`;
    case 'mail-reply-context': return emailReplyContextSemanticText(parsed.data);
    case 'mail-writing-profile': return titledSections([['Description', parsed.data.description], ['Tone', parsed.data.tone], ['Style', parsed.data.style], ['Structure', parsed.data.structure], ['Vocabulary', parsed.data.vocabulary], ['Conventions', parsed.data.conventions]]);
    case 'mail-contact': return titledSections([['Email', parsed.data.email], ['Relationship', parsed.data.relationship], ['Context', parsed.data.context]]);
    case 'mail-rule': return titledSections([['Description', parsed.data.description], ['Condition', parsed.data.condition], ['Instruction', parsed.data.instruction], ['Action', parsed.data.action]]);
  }
}

function legacyValueText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => legacyValueText(item, depth + 1)).filter(Boolean).map((item) => `- ${item}`).join('\n');
  if (!value || typeof value !== 'object' || depth > 3) return '';
  return Object.entries(value as Record<string, unknown>).flatMap(([field, item]) => {
    if (['type', 'kind', 'version', 'emailDraftKey'].includes(field)) return [];
    const rendered = legacyValueText(item, depth + 1);
    if (!rendered) return [];
    const label = field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
    return [`${label}\n\n${rendered}`];
  }).join('\n\n');
}

/** Converts persisted email envelopes from older Archive representations to user-facing text. */
export function legacyEmailArchiveContent(content: string) {
  let payload: unknown;
  try { payload = JSON.parse(content); } catch { return null; }
  const current = emailArchivePayloadSchema.safeParse(payload);
  if (current.success) return emailArchivePayloadContent(current.data);
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const kind = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : '';
  if (record.version !== 1 || !kind.startsWith('mail-')) return null;
  const rendered = legacyValueText(record);
  return rendered || null;
}

export function encodeArchivePayload(payload: unknown) {
  return JSON.stringify(emailArchivePayloadSchema.parse(payload));
}

function decode<Data>(document: unknown, schema: z.ZodTypeAny): ArchiveRecord<Data> {
  const parsedDocument = emailArchiveDocumentSchema.parse(document);
  const payload = schema.parse(JSON.parse(parsedDocument.content)) as { data: Data };
  return { ...payload.data, key: parsedDocument.key, scopeKey: parsedDocument.scopeKey, embedding: parsedDocument.embedding, createdAt: parsedDocument.createdAt, updatedAt: parsedDocument.updatedAt };
}

export const decodeEmailThread = (document: unknown) => decode<z.infer<typeof emailThreadDataSchema>>(document, emailThreadPayloadSchema);
export const decodeEmailMessage = (document: unknown) => decode<z.infer<typeof emailMessageDataSchema>>(document, emailMessagePayloadSchema);
export const decodeEmailDraft = (document: unknown) => decode<z.infer<typeof emailReplyDraftDataSchema> | z.infer<typeof emailNewDraftDataSchema>>(document, emailDraftPayloadSchema);
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
  if (value.content !== semanticText) throw new Error('Prepared Archive reply context does not match its user-facing content.');
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
export const decodeEmailWritingProfile = (document: unknown) => decode<z.infer<typeof emailWritingProfileDataSchema>>(document, emailWritingProfilePayloadSchema);
export const decodeEmailContact = (document: unknown) => decode<z.infer<typeof emailContactDataSchema>>(document, emailContactPayloadSchema);
export const decodeEmailRule = (document: unknown) => decode<z.infer<typeof emailRuleDataSchema>>(document, emailRulePayloadSchema);

export function archiveDocument(input: {
  key: string;
  scopeKey: string;
  folderKey: string;
  name: string;
  content: string;
  embedding?: z.input<typeof currentEmbeddingSchema>;
  representation?: PreparedDocumentRepresentation;
  createdAt: string;
  updatedAt: string;
  mutationPolicy?: 'user' | 'system-only';
  archiveVisibility?: 'visible' | 'domain-only';
  developmentFixtureIdentifier?: string;
}): Document {
  const { mutationPolicy = 'user', archiveVisibility = 'visible', representation, embedding, ...document } = input;
  const content = document.content.trim();
  if (representation && representation.content !== content) throw new Error('Prepared Archive representation does not match the email content.');
  return documentSchema.parse({
    ...document,
    content,
    embedding: representation?.embedding ?? embedding,
    ...(representation ? {
      contentChunks: representation.contentChunks,
      chunkEmbeddings: representation.chunkEmbeddings,
      semanticChunkCount: representation.semanticChunkCount,
      semanticContentHash: representation.semanticContentHash,
    } : {}),
    mutationPolicy,
    archiveVisibility,
    isFavorite: false,
  });
}
