import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { selectRoute, streamRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import type { DocumentProcessingDependencies } from '@/lib/ai/document-processing';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import { organizationMessageContextTool, type OrganizationMessageContext, type OrganizationMessageContextDependencies } from './organization-message-context';

export const orchestratorChatToolInputSchema = z.object({
  message: sanitizedAgentMessageSchema,
}).strict();

export interface OrchestratorChatToolDependencies extends RouterDependencies, DocumentProcessingDependencies, OrganizationMessageContextDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  organizationKey?: string;
  messageContext?: OrganizationMessageContext;
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
    if (dependencies.execute) {
      const chatInput = await prepareChatInput(skill, rawInput, dependencies);
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
    const chatInput = await prepareChatInput(skill, rawInput, dependencies);
    const organizationKey = dependencies.organizationKey ?? 'nexus';
    if (dependencies.stream) {
      yield* dependencies.stream(organizationKey, chatInput);
      return;
    }
    const decision = await selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'orchestrator-chat', modelSlug: 'amazon.nova-lite', providerSlug: 'aws-bedrock' }, dependencies);
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

async function prepareChatInput(skill: string, rawInput: unknown, dependencies: OrchestratorChatToolDependencies): Promise<CoreChatInput> {
  const input = orchestratorChatToolInputSchema.parse(rawInput);
  const context = dependencies.messageContext
    ? await organizationMessageContextTool.execute(input.message, dependencies.messageContext, dependencies)
    : '';
  return buildChatInput(skill, input.message, context);
}

function buildChatInput(skill: string, message: string, context: string): CoreChatInput {
  const parsedSkill = z.string().trim().min(1).parse(skill);
  return coreChatInputSchema.parse({
    systemPrompt: [parsedSkill, context].filter(Boolean).join('\n\n'),
    messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
    options: { maxTokens: 1_200 },
  });
}
