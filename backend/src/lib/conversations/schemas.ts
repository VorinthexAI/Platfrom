import { z } from 'zod';
import { appSearchRetrievalSchema } from '@/lib/app-search/service';

export const conversationSchema = z.object({
  key: z.string().cuid(), teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(),
  userKey: z.string().cuid(), name: z.string().trim().min(1).max(200), isFavorite: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;

const attachmentFilenameSchema = z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value), 'Filename is invalid.');
const attachmentBaseSchema = z.object({ key: z.string().cuid(), filename: attachmentFilenameSchema, sizeBytes: z.number().int().positive().max(25 * 1024 * 1024) });
export const conversationAttachmentReferenceSchema = z.discriminatedUnion('kind', [
  attachmentBaseSchema.extend({ kind: z.literal('document'), mimeType: z.enum(['text/plain', 'text/markdown', 'text/x-markdown', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) }).strict(),
  attachmentBaseSchema.extend({ kind: z.literal('image'), mimeType: z.literal('image/png'), width: z.number().int().positive().max(16_384), height: z.number().int().positive().max(16_384) }).strict(),
]);
export const conversationAttachmentReferencesSchema = z.array(conversationAttachmentReferenceSchema).max(12).refine((references) => new Set(references.map(({ key }) => key)).size === references.length, 'Attachment resource keys must be unique.');
export type ConversationAttachmentReference = z.infer<typeof conversationAttachmentReferenceSchema>;
export const conversationAttachmentStatusSchema = z.enum(['NONE', 'PENDING', 'COMPLETED', 'PARTIAL', 'FAILED']);

export const conversationMessageBaseSchema = z.object({
  key: z.string().cuid(), conversationKey: z.string().cuid(), teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(), userKey: z.string().cuid(), turnKey: z.string().trim().min(1).max(180),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
  role: z.enum(['USER', 'ASSISTANT']), status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  content: z.string().min(1).max(100_000), imageKey: z.string().cuid().optional(), embedding: z.array(z.number().finite()).optional(),
  embeddingProvider: z.string().trim().min(1).max(100).optional(), embeddingModel: z.string().trim().min(1).max(200).optional(), embeddingDimensions: z.number().int().positive().optional(),
  attachments: conversationAttachmentReferencesSchema.default([]),
  attachmentStatus: conversationAttachmentStatusSchema.optional(),
  pendingAttachmentKeys: z.array(z.string().cuid()).max(12).refine((keys) => new Set(keys).size === keys.length, 'Pending attachment keys must be unique.').optional(),
  imageReferenceArtifactKeys: z.array(z.string().cuid()).max(8).refine((keys) => new Set(keys).size === keys.length, 'Image reference artifact keys must be unique.').optional(),
  imageStatusText: z.string().trim().min(1).max(100_000).optional(),
  imageSummaryText: z.string().trim().min(1).max(20_000).optional(),
  retrievals: z.array(appSearchRetrievalSchema).max(4).default([]),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
  fundingRequiredCode: z.enum(['INSUFFICIENT_BALANCE', 'OUTSTANDING_DEBT']).optional(), fundingRequiredAcknowledgedAt: z.string().datetime().optional(),
}).strict();
function resolvedAttachmentStatus(message: Pick<z.infer<typeof conversationMessageBaseSchema>, 'attachments' | 'attachmentStatus' | 'pendingAttachmentKeys'>) {
  return message.attachmentStatus ?? (message.attachments.length ? 'COMPLETED' : message.pendingAttachmentKeys?.length ? 'PENDING' : 'NONE');
}
function validateConversationMessage(message: z.infer<typeof conversationMessageBaseSchema>, context: z.RefinementCtx) {
  const attachmentStatus = resolvedAttachmentStatus(message);
  if (message.role === 'USER' && (message.status !== 'COMPLETED' || !message.completedAt)) context.addIssue({ code: 'custom', path: ['status'], message: 'User messages must be completed.' });
  if (message.status === 'PENDING' && message.completedAt) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Pending messages cannot have a completion time.' });
  if (message.status !== 'PENDING' && !message.completedAt) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Terminal messages require a completion time.' });
  if (message.type === 'TEXT' && message.imageKey) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Text messages cannot reference an image.' });
  if (message.attachments.length && (message.type !== 'TEXT' || message.role !== 'USER')) context.addIssue({ code: 'custom', path: ['attachments'], message: 'Attachments belong only to text user messages.' });
  if (message.pendingAttachmentKeys?.length && (message.type !== 'TEXT' || message.role !== 'USER' || message.attachments.length)) context.addIssue({ code: 'custom', path: ['pendingAttachmentKeys'], message: 'Pending attachments belong only to text user messages without durable attachments.' });
  if (message.imageReferenceArtifactKeys?.length && (message.type !== 'IMAGE' || message.role !== 'ASSISTANT')) context.addIssue({ code: 'custom', path: ['imageReferenceArtifactKeys'], message: 'Staged image references belong only to image responses.' });
  if (message.imageStatusText && (message.type !== 'IMAGE' || message.role !== 'ASSISTANT')) context.addIssue({ code: 'custom', path: ['imageStatusText'], message: 'Image status text belongs only to image responses.' });
  if (message.imageSummaryText && (message.type !== 'IMAGE' || message.role !== 'ASSISTANT' || message.status !== 'COMPLETED')) context.addIssue({ code: 'custom', path: ['imageSummaryText'], message: 'Image summaries belong only to completed image responses.' });
  if (attachmentStatus !== 'NONE' && (message.type !== 'TEXT' || message.role !== 'USER')) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'Attachment persistence status belongs only to text user messages.' });
  if (attachmentStatus === 'NONE' && (message.attachments.length || message.pendingAttachmentKeys?.length)) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'Messages with attachments cannot have NONE attachment status.' });
  if (attachmentStatus === 'PENDING' && (!message.pendingAttachmentKeys?.length || message.attachments.length)) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'PENDING attachment status requires pending attachment keys and no durable attachments.' });
  if (attachmentStatus === 'COMPLETED' && (!message.attachments.length || message.pendingAttachmentKeys?.length)) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'COMPLETED attachment status requires durable attachments and no pending keys.' });
  if (attachmentStatus === 'PARTIAL' && (!message.attachments.length || message.pendingAttachmentKeys?.length)) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'PARTIAL attachment status requires successful durable attachments and no pending keys.' });
  if (attachmentStatus === 'FAILED' && (message.attachments.length || message.pendingAttachmentKeys?.length)) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'FAILED attachment status cannot retain pending keys or durable attachments.' });
  if (message.type === 'IMAGE') {
    if (message.embedding) context.addIssue({ code: 'custom', path: ['embedding'], message: 'Image messages cannot have text embeddings.' });
    if (message.embeddingProvider || message.embeddingModel || message.embeddingDimensions) context.addIssue({ code: 'custom', path: ['embeddingProvider'], message: 'Image messages cannot have text embedding metadata.' });
    if (message.retrievals.length) context.addIssue({ code: 'custom', path: ['retrievals'], message: 'Image messages cannot have retrievals.' });
    if (message.role === 'USER' && message.imageKey) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Image prompts cannot reference their generated image.' });
    if (message.role === 'ASSISTANT' && (message.status === 'COMPLETED') !== Boolean(message.imageKey)) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Only completed image responses require an image reference.' });
  }
  if (message.fundingRequiredCode && (message.type !== 'IMAGE' || message.role !== 'ASSISTANT' || message.status !== 'FAILED')) context.addIssue({ code: 'custom', path: ['fundingRequiredCode'], message: 'Funding requirements belong only to failed assistant image responses.' });
  if (message.fundingRequiredAcknowledgedAt && !message.fundingRequiredCode) context.addIssue({ code: 'custom', path: ['fundingRequiredAcknowledgedAt'], message: 'Funding acknowledgment requires a funding reason.' });
}
export const conversationMessageSchema = conversationMessageBaseSchema.superRefine(validateConversationMessage).transform((message) => ({ ...message, attachmentStatus: resolvedAttachmentStatus(message) }));
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationCreateInputSchema = z.object({ name: z.string().trim().min(1).max(200).optional() }).strict();
export const conversationListInputSchema = z.object({ cursor: z.string().min(1).max(1_000).optional(), limit: z.number().int().min(1).max(100).default(25), favoriteOnly: z.boolean().default(false) }).strict();
export const conversationSearchInputSchema = conversationListInputSchema.extend({ query: z.string().trim().min(1).max(500), recordHistory: z.boolean().default(true) }).strict();
export const conversationKeyInputSchema = z.object({ conversationKey: z.string().cuid() }).strict();
export const conversationRenameInputSchema = conversationKeyInputSchema.extend({ name: z.string().trim().min(1).max(200) }).strict();
export const conversationFavoriteInputSchema = conversationKeyInputSchema.extend({ isFavorite: z.boolean() }).strict();
export const conversationMessageListInputSchema = conversationKeyInputSchema.extend({ cursor: z.string().min(1).max(1_000).optional(), limit: z.number().int().min(1).max(100).default(10) }).strict();
export const conversationMessageDeleteInputSchema = conversationKeyInputSchema.extend({ messageKey: z.string().cuid() }).strict();
export const conversationMessageDeleteResultSchema = z.object({ deletedKeys: z.array(z.string().cuid()).min(1).max(2) }).strict();
export const conversationModelSendInputSchema = conversationKeyInputSchema.extend({ message: z.string().trim().min(1).max(20_000) }).strict();
export const conversationSendInputSchema = conversationModelSendInputSchema.extend({
  requestKey: z.string().trim().min(1).max(180),
  attachmentKeys: z.array(z.string().cuid()).max(12).default([]),
  referenceImageKeys: z.array(z.string().cuid()).max(1).default([]),
}).strict().refine(({ attachmentKeys }) => new Set(attachmentKeys).size === attachmentKeys.length, { path: ['attachmentKeys'], message: 'Attachment keys must be unique.' });
export const conversationImageTurnShape = {
  ...conversationKeyInputSchema.shape,
  prompt: z.string().trim().min(1).max(8_000),
  referenceImageKeys: z.array(z.string().cuid()).max(8).default([]),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024'),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
  mode: z.enum(['default', 'fast']).default('default'),
} as const;
export const conversationImageTurnRequestKeySchema = z.string().trim().min(1).max(180);
const uniqueImageReferences = ({ referenceImageKeys }: { referenceImageKeys: string[] }) => new Set(referenceImageKeys).size === referenceImageKeys.length;
export const conversationImageTurnInputSchema = z.object({ ...conversationImageTurnShape, requestKey: conversationImageTurnRequestKeySchema, userMessage: conversationModelSendInputSchema.shape.message.optional() }).strict().refine(uniqueImageReferences, { path: ['referenceImageKeys'], message: 'Reference image keys must be unique.' });
const conversationSafeMessageBaseSchema = conversationMessageBaseSchema.omit({ embedding: true, embeddingProvider: true, embeddingModel: true, embeddingDimensions: true, pendingAttachmentKeys: true, imageReferenceArtifactKeys: true, imageStatusText: true, teamKey: true, scopeKey: true, userKey: true, requestHash: true, fundingRequiredCode: true, fundingRequiredAcknowledgedAt: true });
export const conversationSafeMessageSchema = conversationSafeMessageBaseSchema.superRefine((message, context) => {
  const attachmentStatus = message.attachmentStatus ?? (message.attachments.length ? 'COMPLETED' : 'NONE');
  if (attachmentStatus !== 'NONE' && (message.type !== 'TEXT' || message.role !== 'USER')) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'Attachment persistence status belongs only to text user messages.' });
  if (attachmentStatus === 'NONE' && message.attachments.length) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'Messages with durable attachments cannot have NONE attachment status.' });
  if (attachmentStatus === 'COMPLETED' && !message.attachments.length) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'COMPLETED attachment status requires durable attachments.' });
  if (attachmentStatus === 'PARTIAL' && !message.attachments.length) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: 'PARTIAL attachment status requires successful durable attachments.' });
  if ((attachmentStatus === 'PENDING' || attachmentStatus === 'FAILED') && message.attachments.length) context.addIssue({ code: 'custom', path: ['attachmentStatus'], message: `${attachmentStatus} attachment status cannot expose durable attachments.` });
}).transform((message) => ({ ...message, attachmentStatus: message.attachmentStatus ?? (message.attachments.length ? 'COMPLETED' as const : 'NONE' as const) }));
export const conversationImageTurnResultSchema = z.object({ user: conversationSafeMessageSchema, assistant: conversationSafeMessageSchema, replayed: z.boolean() }).strict();
export function projectConversationMessage(message: ConversationMessage) {
  const { embedding: _embedding, embeddingProvider: _embeddingProvider, embeddingModel: _embeddingModel, embeddingDimensions: _embeddingDimensions, pendingAttachmentKeys: _pendingAttachmentKeys, imageReferenceArtifactKeys: _imageReferenceArtifactKeys, imageStatusText: _imageStatusText, teamKey: _teamKey, scopeKey: _scopeKey, userKey: _userKey, requestHash: _requestHash, fundingRequiredCode: _fundingRequiredCode, fundingRequiredAcknowledgedAt: _fundingRequiredAcknowledgedAt, ...safe } = message;
  return conversationSafeMessageSchema.parse(message.type === 'IMAGE' && message.role === 'ASSISTANT' ? { ...safe, content: message.imageStatusText ?? 'Image generation is in progress.' } : safe);
}
export function encodeCursor(value: Record<string, unknown>) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!cursor) return undefined;
  try { return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor' }]); }
}
