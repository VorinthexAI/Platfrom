import { z } from 'zod';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions';
import { selectRoute, streamRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput, ProviderExecuteResponse, ProviderStreamChunk } from '@/lib/ai/providers';
import { sanitizedAgentMessageSchema } from './input-sanitizer';
import { processDocument, type DocumentProcessingDependencies, type DocumentProcessingInput, type DocumentProcessingResult } from '@/lib/ai/document-processing';

export const TOOL_NAMES = ['orchestrator.chat', 'document.processing'] as const;
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
}, {
  name: 'document.processing',
  description: 'Validate, store, extract, transform, embed, and insert an Archive document.',
  inputSchema: {
    type: 'object',
    required: ['file', 'scopeKey', 'folderKey'],
    additionalProperties: false,
    properties: {
      file: { type: 'object', description: 'A server-side uploaded file abstraction.' },
      scopeKey: { type: 'string' },
      folderKey: { type: 'string' },
      name: { type: 'string', maxLength: 255 },
      idempotencyKey: { type: 'string', maxLength: 200 },
    },
  },
}] as const;

export const orchestratorChatToolInputSchema = z.object({
  message: sanitizedAgentMessageSchema,
}).strict();

export interface ToolDependencies extends RouterDependencies, DocumentProcessingDependencies {
  execute?: (organizationKey: string, input: CoreChatInput) => Promise<ProviderExecuteResponse<ChatOutput>>;
  stream?: (organizationKey: string, input: CoreChatInput) => AsyncIterable<ProviderStreamChunk>;
  signal?: AbortSignal;
}

const chatOutputSchema = z.object({
  text: z.string().trim().min(1),
  toolCalls: z.array(z.unknown()),
  stopReason: z.string().nullable(),
}).strict();

/** Executes one of the capabilities exposed by the unified tool registry. */
export function runTool(name: 'orchestrator.chat', skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string>;
export function runTool(name: 'document.processing', skill: string, rawInput: DocumentProcessingInput, dependencies?: ToolDependencies): Promise<DocumentProcessingResult>;
export function runTool(name: string, skill: string, rawInput: unknown, dependencies?: ToolDependencies): Promise<string | DocumentProcessingResult>;
export async function runTool(name: string, skill: string, rawInput: unknown, dependencies: ToolDependencies = {}): Promise<string | DocumentProcessingResult> {
  const toolName = toolNameSchema.parse(name);
  if (toolName === 'document.processing') return processDocument(rawInput as DocumentProcessingInput, dependencies);

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
