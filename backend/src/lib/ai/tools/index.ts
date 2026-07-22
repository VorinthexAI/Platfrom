import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { selectRoute, streamRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { DocumentProcessingDependencies } from '@/lib/ai/document-processing';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { DOCUMENT_TOOL_DEFINITIONS, DOCUMENT_TOOL_NAMES, isDocumentToolName, runDocumentTool, type DocumentToolDependencies, type DocumentToolInput, type DocumentToolName, type DocumentToolOutput } from './document-tools';
import { CHANNEL_REGISTERED_TOOL_DEFINITIONS, CHANNEL_TOOL_NAMES, isChannelToolName, runChannelTool, type ChannelToolDependencies, type ChannelToolOutput } from './channel-tools';
import type { ChannelToolSlug } from '@/lib/ai/channel/tools';

export const TOOL_NAMES = ['orchestrator.chat', ...DOCUMENT_TOOL_NAMES, ...CHANNEL_TOOL_NAMES] as const;
export const toolNameSchema = z.enum(TOOL_NAMES);

export const TOOL_DEFINITIONS = [{
  name: 'orchestrator.chat',
  description: 'Answer the user through the orchestrator chat action.',
  inputSchema: {
    type: 'object',
    required: ['message'],
    additionalProperties: false,
    properties: { message: { type: 'string', maxLength: 8_000 } },
  },
}, ...DOCUMENT_TOOL_DEFINITIONS, ...CHANNEL_REGISTERED_TOOL_DEFINITIONS] as const;

export const orchestratorChatToolInputSchema = z.object({
  message: sanitizedAgentMessageSchema,
}).strict();

export interface ToolDependencies extends RouterDependencies, DocumentProcessingDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  documentContext?: DomainToolContext;
  documentDependencies?: DocumentToolDependencies;
  channelContext?: DomainToolContext;
  channelDependencies?: ChannelToolDependencies;
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'orchestrator.chat', skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string>;
export function runTool<Name extends DocumentToolName>(name: Name, skill: string, rawInput: DocumentToolInput<Name>, dependencies: ToolDependencies & { documentContext: DomainToolContext }): Promise<DocumentToolOutput<Name>>;
export function runTool<Name extends ChannelToolSlug>(name: Name, skill: string, rawInput: unknown, dependencies: ToolDependencies & { channelContext: DomainToolContext }): Promise<ChannelToolOutput>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<unknown> {
  const toolName = toolNameSchema.parse(name);
  if (isDocumentToolName(toolName)) {
    if (dependencies.documentContext) {
      return runDocumentTool(toolName, rawInput, dependencies.documentContext, {
        adapters: dependencies.adapters,
        credentials: dependencies.credentials,
        ...dependencies.documentDependencies,
        ingestion: { ...dependencies, ...dependencies.documentDependencies?.ingestion },
      });
    }
    throw new Error(`Tool ${toolName} requires documentContext.`);
  }
  if (isChannelToolName(toolName)) {
    if (dependencies.channelContext) return runChannelTool(toolName, rawInput, dependencies.channelContext, dependencies.channelDependencies);
    throw new Error(`Tool ${toolName} requires channelContext.`);
  }

  const chatInput = buildChatInput(skill, rawInput);
  if (dependencies.execute) {
    const response = await dependencies.execute('nexus', chatInput);
    return chatOutputSchema.parse(response.output).text;
  }
  let text = '';
  for await (const chunk of streamTool(toolName, skill, rawInput, dependencies)) {
    if (chunk.type === 'text-delta') text += chunk.text;
  }
  return z.string().trim().min(1).parse(text);
}

export async function* streamTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): AsyncIterable<ProviderStreamChunk> {
  const toolName = toolNameSchema.parse(name);
  if (toolName !== 'orchestrator.chat') throw new Error(`Tool ${toolName} does not support streaming.`);
  const chatInput = buildChatInput(skill, rawInput);
  const organizationKey = 'nexus';
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
}

function buildChatInput(skill: string, rawInput: unknown): CoreChatInput {
  const input = orchestratorChatToolInputSchema.parse(rawInput);
  const parsedSkill = z.string().trim().min(1).parse(skill);
  return coreChatInputSchema.parse({
    systemPrompt: parsedSkill,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.message }] }],
    options: { maxTokens: 2_000 },
  });
}

export { sanitizeAgentInput, sanitizedAgentMessageSchema } from './input-sanitizer';
export * from './document-tools';
export * from './channel-tools';
