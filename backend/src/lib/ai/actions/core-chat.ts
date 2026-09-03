import { z } from 'zod';

export const CORE_CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CORE_CHAT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const CORE_CHAT_MAX_IMAGE_BYTES_TOTAL = 16 * 1024 * 1024;
export const CORE_CHAT_MAX_IMAGES = 8;

export const coreChatContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
  z.object({
    type: z.literal('image'),
    mimeType: z.enum(CORE_CHAT_IMAGE_MIME_TYPES),
    bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= CORE_CHAT_MAX_IMAGE_BYTES, `Image bytes must contain at most ${CORE_CHAT_MAX_IMAGE_BYTES} bytes.`),
  }).strict(),
  z.object({ type: z.literal('tool-call'), toolCallId: z.string().min(1), name: z.string().min(1), arguments: z.unknown(), opaqueState: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('tool-result'), toolCallId: z.string().min(1), result: z.unknown() }).strict(),
]);
export type CoreChatContent = z.infer<typeof coreChatContentSchema>;

export const coreChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.array(coreChatContentSchema).min(1),
  toolCallId: z.string().min(1).optional(),
}).strict();
export type CoreChatMessage = z.infer<typeof coreChatMessageSchema>;

export const coreChatToolDefinitionSchema = z.object({ name: z.string().min(1), description: z.string().default(''), inputSchema: z.record(z.unknown()).default({}) }).strict();
export type CoreChatToolDefinition = z.infer<typeof coreChatToolDefinitionSchema>;
export const coreChatResponseFormatSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), schema: z.record(z.unknown()) }).strict();

/** Provider-neutral multimodal message protocol used by text actions. */
export const coreChatInputSchema = z.object({
  mode: z.enum(['default', 'deep']).optional().default('default'),
  messages: z.array(coreChatMessageSchema).min(1),
  systemPrompt: z.string().min(1).optional(),
  tools: z.array(coreChatToolDefinitionSchema).optional(),
  responseFormat: coreChatResponseFormatSchema.optional(),
  options: z.object({
    voiceKey: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  let imageCount = 0;
  let imageBytes = 0;
  value.messages.forEach((message, messageIndex) => {
    message.content.forEach((part, partIndex) => {
      if (part.type !== 'image') return;
      imageCount += 1;
      imageBytes += part.bytes.byteLength;
      if (message.role !== 'user') context.addIssue({ code: 'custom', path: ['messages', messageIndex, 'content', partIndex], message: 'Images are allowed only in user messages.' });
    });
  });
  if (imageCount > CORE_CHAT_MAX_IMAGES) context.addIssue({ code: 'custom', path: ['messages'], message: `Chat input supports at most ${CORE_CHAT_MAX_IMAGES} images.` });
  if (imageBytes > CORE_CHAT_MAX_IMAGE_BYTES_TOTAL) context.addIssue({ code: 'custom', path: ['messages'], message: `Chat image bytes must not exceed ${CORE_CHAT_MAX_IMAGE_BYTES_TOTAL} bytes.` });
});
export type CoreChatInput = z.input<typeof coreChatInputSchema>;
export type ParsedCoreChatInput = z.output<typeof coreChatInputSchema>;
