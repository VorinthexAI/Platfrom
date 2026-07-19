import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import { CHAT_ACTION_IDS, unsupportedAction } from './openai-compatible';
import {
  chatInputSchema,
  resolveRequestSignal,
  type ChatInput,
  type ChatOutput,
  type NormalizedToolCall,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type ProviderStreamChunk,
} from './types';

export const anthropicProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
  })
  .strict();

export type AnthropicProviderConfig = z.infer<typeof anthropicProviderConfigSchema>;
export const anthropicCredentialsSchema = anthropicProviderConfigSchema;
export type AnthropicCredentials = AnthropicProviderConfig;

const PROVIDER_ID = 'anthropic' as const;

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

function buildMessageParams(externalModelId: string, input: ChatInput): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const messages: Anthropic.Messages.MessageParam[] = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  for (const message of input.messages) {
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'Anthropic adapter does not support non-text core.chat content');
    // Anthropic has no system role inside `messages` — fold system-role
    // messages into the top-level system prompt instead.
    if (message.role === 'system') {
      systemParts.push(text);
      continue;
    }
    if (message.role === 'tool') throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'Anthropic adapter does not support core.chat tool-result messages');
    messages.push({ role: message.role, content: text });
  }
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: externalModelId,
    max_tokens: input.options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
  };
  if (systemParts.length > 0) params.system = systemParts.join('\n\n');
  if (input.options?.temperature !== undefined) params.temperature = Math.min(input.options.temperature, 1);
  if (input.tools && input.tools.length > 0) {
    params.tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: { type: 'object' as const, ...tool.inputSchema },
    }));
  }
  return params;
}

function normalizeMessage(message: Anthropic.Messages.Message): ChatOutput {
  const textParts: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') textParts.push(block.text);
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
  }
  return { text: textParts.join(''), toolCalls, stopReason: message.stop_reason ?? null };
}

export function createAnthropicProvider(config: AnthropicProviderConfig): ProviderAdapter {
  const parsed = anthropicProviderConfigSchema.parse(config);
  const client = new Anthropic({ apiKey: parsed.apiKey, baseURL: parsed.baseUrl });

  return {
    id: PROVIDER_ID,
    name: 'Anthropic',

    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      const input = chatInputSchema.parse(request.input);
      try {
        const message = await client.messages.create(buildMessageParams(request.externalModelId, input), {
          signal: resolveRequestSignal(request),
        });
        return {
          output: normalizeMessage(message) as TOutput,
          usage: tokenUsage(message.usage.input_tokens, message.usage.output_tokens),
          providerId: PROVIDER_ID,
          modelId: request.modelId,
          externalModelId: request.externalModelId,
          rawResponse: message,
        };
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
    },

    async *stream<TInput>(request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      const input = chatInputSchema.parse(request.input);
      try {
        const stream = await client.messages.create(
          { ...buildMessageParams(request.externalModelId, input), stream: true },
          { signal: resolveRequestSignal(request) },
        );
        let inputTokens = 0;
        let outputTokens = 0;
        for await (const event of stream) {
          if (event.type === 'message_start') {
            inputTokens = event.message.usage.input_tokens;
          }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text-delta', text: event.delta.text };
          }
          if (event.type === 'message_delta') {
            outputTokens = event.usage.output_tokens;
          }
        }
        yield { type: 'usage', usage: tokenUsage(inputTokens, outputTokens) };
        yield { type: 'done' };
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
    },
  };
}

export const anthropicProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: anthropicProviderConfigSchema,
  create(config) {
    return createAnthropicProvider(anthropicProviderConfigSchema.parse(config));
  },
};
