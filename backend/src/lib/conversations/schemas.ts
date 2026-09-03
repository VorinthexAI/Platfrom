import { z } from 'zod';
import { appSearchRetrievalSchema } from '@/lib/app-search/service';

export const conversationSchema = z.object({
  key: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(),
  userKey: z.string().cuid(), name: z.string().trim().min(1).max(200), isFavorite: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationMessageBaseSchema = z.object({
  key: z.string().cuid(), conversationKey: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(), userKey: z.string().cuid(), turnKey: z.string().trim().min(1).max(180),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
  role: z.enum(['USER', 'ASSISTANT']), status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  content: z.string().min(1).max(100_000), imageKey: z.string().cuid().optional(), embedding: z.array(z.number().finite()).optional(),
  retrievals: z.array(appSearchRetrievalSchema).max(4).default([]),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
}).strict();
function validateConversationMessage(message: z.infer<typeof conversationMessageBaseSchema>, context: z.RefinementCtx) {
  if (message.role === 'USER' && (message.status !== 'COMPLETED' || !message.completedAt)) context.addIssue({ code: 'custom', path: ['status'], message: 'User messages must be completed.' });
  if (message.status === 'PENDING' && message.completedAt) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Pending messages cannot have a completion time.' });
  if (message.status !== 'PENDING' && !message.completedAt) context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Terminal messages require a completion time.' });
  if (message.type === 'TEXT' && message.imageKey) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Text messages cannot reference an image.' });
  if (message.type === 'IMAGE') {
    if (message.embedding) context.addIssue({ code: 'custom', path: ['embedding'], message: 'Image messages cannot have text embeddings.' });
    if (message.retrievals.length) context.addIssue({ code: 'custom', path: ['retrievals'], message: 'Image messages cannot have retrievals.' });
    if (message.role === 'USER' && message.imageKey) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Image prompts cannot reference their generated image.' });
    if (message.role === 'ASSISTANT' && (message.status === 'COMPLETED') !== Boolean(message.imageKey)) context.addIssue({ code: 'custom', path: ['imageKey'], message: 'Only completed image responses require an image reference.' });
  }
}
export const conversationMessageSchema = conversationMessageBaseSchema.superRefine(validateConversationMessage);
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
  attachmentKeys: z.array(z.string().cuid()).max(10).default([]),
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
export const conversationImageTurnModelInputSchema = z.object(conversationImageTurnShape).omit({ conversationKey: true }).strict().refine(uniqueImageReferences, { path: ['referenceImageKeys'], message: 'Reference image keys must be unique.' });
export const conversationImageTurnInputSchema = z.object({ ...conversationImageTurnShape, requestKey: conversationImageTurnRequestKeySchema }).strict().refine(uniqueImageReferences, { path: ['referenceImageKeys'], message: 'Reference image keys must be unique.' });
export const agentQueryInputSchema = z.object({ query: z.string().trim().min(1).max(20_000), limit: z.number().int().min(1).max(20).default(20) }).strict();

export const conversationSafeMessageSchema = conversationMessageBaseSchema.omit({ embedding: true, organizationKey: true, scopeKey: true, userKey: true, requestHash: true }).superRefine((message, context) => validateConversationMessage({ ...message, organizationKey: 'safe', scopeKey: message.conversationKey, userKey: message.key, requestHash: '0'.repeat(64) }, context));
export const conversationImageTurnResultSchema = z.object({ user: conversationSafeMessageSchema, assistant: conversationSafeMessageSchema, replayed: z.boolean() }).strict();
export function projectConversationMessage(message: ConversationMessage) {
  const { embedding: _embedding, organizationKey: _organizationKey, scopeKey: _scopeKey, userKey: _userKey, requestHash: _requestHash, ...safe } = message;
  return conversationSafeMessageSchema.parse(safe);
}
export function encodeCursor(value: Record<string, unknown>) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!cursor) return undefined;
  try { return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor' }]); }
}
