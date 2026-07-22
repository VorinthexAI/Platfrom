import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { selectRoute, streamRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import type { DocumentProcessingDependencies } from '@/lib/ai/document-processing';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { ARCHIVE_TOOL_DEFINITIONS, ARCHIVE_TOOL_NAMES, isArchiveToolName, runArchiveTool, type ArchiveToolDependencies, type ArchiveToolInput, type ArchiveToolName, type ArchiveToolOutput } from './archive';
import { CHORUS_REGISTERED_TOOL_DEFINITIONS, CHORUS_TOOL_NAMES, isChorusToolName, runChorusTool, type ChorusToolDependencies, type ChorusToolOutput } from './chorus';
import type { ChorusToolSlug } from '@/lib/ai/chorus/tools';

export const TOOL_NAMES = ['orchestrator.chat', ...ARCHIVE_TOOL_NAMES, ...CHORUS_TOOL_NAMES] as const;
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
}, ...ARCHIVE_TOOL_DEFINITIONS, ...CHORUS_REGISTERED_TOOL_DEFINITIONS] as const;

export const orchestratorChatToolInputSchema = z.object({
  message: sanitizedAgentMessageSchema,
}).strict();

export interface ToolDependencies extends RouterDependencies, DocumentProcessingDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
  archiveContext?: DomainToolContext;
  archiveDependencies?: ArchiveToolDependencies;
  chorusContext?: DomainToolContext;
  chorusDependencies?: ChorusToolDependencies;
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'orchestrator.chat', skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string>;
export function runTool<Name extends ArchiveToolName>(name: Name, skill: string, rawInput: ArchiveToolInput<Name>, dependencies: ToolDependencies & { archiveContext: DomainToolContext }): Promise<ArchiveToolOutput<Name>>;
export function runTool<Name extends ChorusToolSlug>(name: Name, skill: string, rawInput: unknown, dependencies: ToolDependencies & { chorusContext: DomainToolContext }): Promise<ChorusToolOutput>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<unknown>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<unknown> {
  const toolName = toolNameSchema.parse(name);
  if (isArchiveToolName(toolName)) {
    if (dependencies.archiveContext) {
      return runArchiveTool(toolName, rawInput, dependencies.archiveContext, {
        adapters: dependencies.adapters,
        credentials: dependencies.credentials,
        ...dependencies.archiveDependencies,
        ingestion: { ...dependencies, ...dependencies.archiveDependencies?.ingestion },
      });
    }
    throw new Error(`Tool ${toolName} requires archiveContext.`);
  }
  if (isChorusToolName(toolName)) {
    if (dependencies.chorusContext) return runChorusTool(toolName, rawInput, dependencies.chorusContext, dependencies.chorusDependencies);
    throw new Error(`Tool ${toolName} requires chorusContext.`);
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
export * from './archive';
export * from './chorus';
