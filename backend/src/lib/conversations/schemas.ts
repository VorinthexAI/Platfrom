import { z } from 'zod';

export const conversationSchema = z.object({
  key: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(),
  userKey: z.string().cuid(), name: z.string().trim().min(1).max(200), isFavorite: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationMessageSchema = z.object({
  key: z.string().cuid(), conversationKey: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(), userKey: z.string().cuid(), turnKey: z.string().trim().min(1).max(180),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(['USER', 'ASSISTANT']), status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  content: z.string().min(1).max(100_000), embedding: z.array(z.number().finite()).optional(),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
}).strict();
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationCreateInputSchema = z.object({ name: z.string().trim().min(1).max(200).optional() }).strict();
export const conversationListInputSchema = z.object({ cursor: z.string().min(1).max(1_000).optional(), limit: z.number().int().min(1).max(100).default(25), favoriteOnly: z.boolean().default(false) }).strict();
export const conversationSearchInputSchema = conversationListInputSchema.extend({ query: z.string().trim().min(1).max(500), recordHistory: z.boolean().default(true) }).strict();
export const conversationKeyInputSchema = z.object({ conversationKey: z.string().cuid() }).strict();
export const conversationRenameInputSchema = conversationKeyInputSchema.extend({ name: z.string().trim().min(1).max(200) }).strict();
export const conversationFavoriteInputSchema = conversationKeyInputSchema.extend({ isFavorite: z.boolean() }).strict();
export const conversationMessageListInputSchema = conversationKeyInputSchema.extend({ cursor: z.string().min(1).max(1_000).optional(), limit: z.number().int().min(1).max(100).default(25) }).strict();
export const conversationModelSendInputSchema = conversationKeyInputSchema.extend({ message: z.string().trim().min(1).max(20_000) }).strict();
export const conversationSendInputSchema = conversationModelSendInputSchema.extend({ requestKey: z.string().trim().min(1).max(180) }).strict();
export const assistantQueryInputSchema = z.object({ query: z.string().trim().min(1).max(20_000), limit: z.number().int().min(1).max(50).default(50) }).strict();

export const conversationSafeMessageSchema = conversationMessageSchema.omit({ embedding: true, organizationKey: true, scopeKey: true, userKey: true, requestHash: true });
export function projectConversationMessage(message: ConversationMessage) {
  const { embedding: _embedding, organizationKey: _organizationKey, scopeKey: _scopeKey, userKey: _userKey, requestHash: _requestHash, ...safe } = message;
  return conversationSafeMessageSchema.parse(safe);
}
export const firstConversationAnswerSchema = z.object({ name: z.string().trim().min(1).max(200), response: z.string().trim().min(1).max(100_000) }).strict();

export function encodeCursor(value: Record<string, unknown>) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!cursor) return undefined;
  try { return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor' }]); }
}
