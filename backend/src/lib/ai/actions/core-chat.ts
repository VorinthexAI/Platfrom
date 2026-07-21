import { z } from 'zod';

export const coreChatContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal('audio'), artifactKey: z.string().min(1), format: z.enum(['pcm', 'wav', 'opus', 'mp3']), sampleRate: z.number().int().positive().optional() }).strict(),
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

/** Provider-neutral multimodal input for the `core.chat` action. */
export const coreChatInputSchema = z.object({
  organizationProviderKey: z.string().min(1).optional(),
  messages: z.array(coreChatMessageSchema).min(1),
  systemPrompt: z.string().min(1).optional(),
  tools: z.array(coreChatToolDefinitionSchema).optional(),
  options: z.object({
    voiceKey: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict();
export type CoreChatInput = z.infer<typeof coreChatInputSchema>;
