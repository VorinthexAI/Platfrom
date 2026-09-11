import { z } from 'zod';
import type { ProviderExecutionCapabilities } from '@/lib/ai/providers';
import { CORE_CHAT_DOCUMENT_MIME_TYPES, CORE_CHAT_IMAGE_MIME_TYPES, CORE_CHAT_MAX_ATTACHMENTS, CORE_CHAT_MAX_FILE_BYTES, CORE_CHAT_MAX_IMAGE_BYTES, CORE_CHAT_MAX_IMAGE_BYTES_TOTAL, CORE_CHAT_MAX_IMAGES } from '@/lib/ai/actions/core-chat';

const internalAgentAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), filename: z.string().trim().min(1).max(255), mimeType: z.enum(CORE_CHAT_IMAGE_MIME_TYPES), bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= CORE_CHAT_MAX_IMAGE_BYTES) }).strict(),
  z.object({ kind: z.literal('document'), filename: z.string().trim().min(1).max(255), mimeType: z.enum(CORE_CHAT_DOCUMENT_MIME_TYPES), bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= CORE_CHAT_MAX_FILE_BYTES) }).strict(),
]);

const boundedUnknownSchema = z.unknown().refine((value) => {
  try { return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') <= 40_000; } catch { return false; }
}, 'Serialized value exceeds 40000 bytes.');

export const agentContextMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100_000),
  createdAt: z.string().datetime(),
}).strict();

export const internalAgentRequestSchema = z.object({
  systemPrompt: z.string().trim().min(1).max(20_000),
  context: z.array(agentContextMessageSchema).max(50).optional(),
  recalledContext: z.array(agentContextMessageSchema).max(20).optional(),
  message: z.string().trim().min(1).max(20_000),
  currentDate: z.string().datetime(),
  requestKey: z.string().trim().min(1).max(180),
  generateName: z.boolean().default(false),
  attachments: z.array(internalAgentAttachmentSchema).max(CORE_CHAT_MAX_ATTACHMENTS).default([]),
}).strict().superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify({ context: value.context ?? [], recalledContext: value.recalledContext ?? [] }), 'utf8') > 250_000) {
    context.addIssue({ code: 'custom', path: ['recalledContext'], message: 'Serialized conversation context exceeds 250000 bytes.' });
  }
  const images = value.attachments.filter((attachment) => attachment.kind === 'image');
  if (images.length > CORE_CHAT_MAX_IMAGES) context.addIssue({ code: 'custom', path: ['attachments'], message: `Agent input supports at most ${CORE_CHAT_MAX_IMAGES} images.` });
  if (images.reduce((total, image) => total + image.bytes.byteLength, 0) > CORE_CHAT_MAX_IMAGE_BYTES_TOTAL) context.addIssue({ code: 'custom', path: ['attachments'], message: `Agent image bytes must not exceed ${CORE_CHAT_MAX_IMAGE_BYTES_TOTAL} bytes.` });
});
export type InternalAgentRequest = z.infer<typeof internalAgentRequestSchema>;

export const coreAgentToolInputSchema = z.object({
  context: z.array(agentContextMessageSchema).max(50).optional(),
  message: z.string().trim().min(1).max(20_000),
  generateName: z.boolean().default(false),
}).strict();

export const agentToolInvocationSchema = z.object({
  slug: z.string().min(1),
  arguments: boundedUnknownSchema,
}).strict();

export const agentToolStatusSchema = agentToolInvocationSchema.extend({
  status: z.enum(['succeeded', 'failed']),
  result: boundedUnknownSchema.optional(),
  error: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'succeeded' && value.result === undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'A succeeded tool requires a result.' });
  if (value.status === 'succeeded' && value.error !== undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'A succeeded tool cannot contain an error.' });
  if (value.status === 'failed' && value.error === undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'A failed tool requires an error.' });
  if (value.status === 'failed' && value.result !== undefined) context.addIssue({ code: 'custom', path: ['result'], message: 'A failed tool cannot contain a result.' });
});
export type AgentToolStatus = z.infer<typeof agentToolStatusSchema>;

export const agentResponseSchema = z.object({
  message: z.string().max(100_000).refine((value) => value.trim().length > 0, 'Agent message must not be blank.'),
  name: z.string().trim().min(1).max(200).optional(),
  tools: z.array(agentToolStatusSchema).max(4),
}).strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const agentToolPatternSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.(?:[a-z][a-z0-9-]*|\*))+$/);

export interface AgentDefinition {
  slug: string;
  systemPrompt: string;
  allowlist: readonly string[];
  excludedTools: readonly string[];
  capabilities?: ProviderExecutionCapabilities;
}
