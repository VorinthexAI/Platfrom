import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { selectRoute, streamRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import type { DocumentProcessingDependencies } from '@/lib/ai/document-processing';
import { sanitizedAgentMessageSchema } from './input-sanitizer';

export const orchestratorChatToolInputSchema = z.object({
  message: sanitizedAgentMessageSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: sanitizedAgentMessageSchema }).strict()).max(40).optional(),
}).strict();

export interface OrchestratorChatToolDependencies extends RouterDependencies, DocumentProcessingDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  organizationKey?: string;
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

export const orchestratorChatTool = {
  name: 'chat',
  inputSchema: orchestratorChatToolInputSchema,
  providerDefinition: {
    name: 'chat',
    description: 'Answer the user through the orchestrator chat action.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      additionalProperties: false,
      properties: { message: { type: 'string', maxLength: 8_000 } },
    },
  },
  async execute(skill: string, rawInput: unknown, dependencies: OrchestratorChatToolDependencies = {}): Promise<string> {
    const chatInput = buildChatInput(skill, rawInput);
    if (dependencies.execute) {
      const response = await dependencies.execute(dependencies.organizationKey ?? 'nexus', chatInput);
      return chatOutputSchema.parse(response.output).text;
    }
    let text = '';
    for await (const chunk of this.stream(skill, rawInput, dependencies)) {
      if (chunk.type === 'text-delta') text += chunk.text;
    }
    return z.string().trim().min(1).parse(text);
  },
  async *stream(skill: string, rawInput: unknown, dependencies: OrchestratorChatToolDependencies = {}): AsyncIterable<ProviderStreamChunk> {
    const chatInput = buildChatInput(skill, rawInput);
    const organizationKey = dependencies.organizationKey ?? 'nexus';
    if (dependencies.stream) {
      yield* dependencies.stream(organizationKey, chatInput);
      return;
    }
    const decision = await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'orchestrator-chat' }, dependencies);
    yield* streamRoute({
      decision,
      input: chatInput,
      adapters: dependencies.adapters,
      credentials: dependencies.credentials,
      timeoutMs: 300_000,
      signal: dependencies.signal,
    });
  },
} as const;

function buildChatInput(skill: string, rawInput: unknown): CoreChatInput {
  const input = orchestratorChatToolInputSchema.parse(rawInput);
  const parsedSkill = z.string().trim().min(1).parse(skill);
  return coreChatInputSchema.parse({
    systemPrompt: parsedSkill,
    messages: [
      ...(input.history ?? []).map(({ role, content }) => ({ role, content: [{ type: 'text' as const, text: content }] })),
      ...((input.history?.at(-1)?.role === 'user' && input.history.at(-1)?.content === input.message) ? [] : [{ role: 'user' as const, content: [{ type: 'text' as const, text: input.message }] }]),
    ],
    options: { maxTokens: 2_000 },
  });
}
