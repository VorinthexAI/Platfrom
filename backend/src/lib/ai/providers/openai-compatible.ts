import type OpenAI from 'openai';
import { tokenUsage, type TokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import {
  chatInputSchema,
  resolveRequestSignal,
  type ChatInput,
  type ChatOutput,
  type NormalizedToolCall,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderId,
  type ProviderStreamChunk,
} from './types';

/**
 * INTERNAL helper for the OpenAI-compatible chat surface shared by the
 * openai, xai, openrouter, and azure-ai-foundry adapters. Each of those
 * provider modules still owns its configuration schema, client
 * construction, and any provider-specific behavior — this module only
 * removes the duplication in request transformation and response
 * normalization for the wire format they all share. Not exported from the
 * providers barrel.
 */

export const CHAT_ACTION_IDS = new Set(['core.chat', 'core.reason']);

export interface OpenAICompatibleOptions {
  /** gpt-5-era OpenAI/Azure endpoints require `max_completion_tokens`; other compatible providers use `max_tokens`. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
}

export function buildChatCompletionParams(
  externalModelId: string,
  input: ChatInput,
  options: OpenAICompatibleOptions,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  for (const message of input.messages) {
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError('openai', 'unsupported_action', 'This provider adapter does not support non-text core.chat content');
    if (message.role === 'tool') {
      if (!message.toolCallId) throw new ProviderError('openai', 'response_invalid', 'core.chat tool messages require toolCallId');
      messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: text });
    } else {
      messages.push({ role: message.role, content: text });
    }
  }

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: externalModelId,
    messages,
  };
  if (input.options?.maxTokens !== undefined) {
    if (options.maxTokensParam === 'max_completion_tokens') params.max_completion_tokens = input.options.maxTokens;
    else params.max_tokens = input.options.maxTokens;
  }
  if (input.options?.temperature !== undefined) params.temperature = input.options.temperature;
  if (input.tools && input.tools.length > 0) {
    params.tools = input.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  return params;
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function normalizeChatCompletion(providerId: ProviderId, completion: OpenAI.Chat.Completions.ChatCompletion): {
  output: ChatOutput;
  usage: TokenUsage;
} {
  const choice = completion.choices[0];
  if (!choice) {
    throw new ProviderError(providerId, 'response_invalid', `${providerId} returned no choices`);
  }
  const toolCalls: NormalizedToolCall[] = [];
  for (const call of choice.message.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    toolCalls.push({ id: call.id, name: call.function.name, arguments: parseToolArguments(call.function.arguments) });
  }
  return {
    output: {
      text: choice.message.content ?? '',
      toolCalls,
      stopReason: choice.finish_reason ?? null,
    },
    usage: tokenUsage(completion.usage?.prompt_tokens, completion.usage?.completion_tokens, completion.usage?.total_tokens),
  };
}

/** Runs one OpenAI-compatible chat completion and normalizes the result. */
export async function executeOpenAICompatibleChat<TInput, TOutput>(
  providerId: ProviderId,
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
  options: OpenAICompatibleOptions,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = chatInputSchema.parse(request.input);
  const params = buildChatCompletionParams(request.externalModelId, input, options);
  try {
    const completion = await client.chat.completions.create(params, {
      signal: resolveRequestSignal(request),
    });
    const { output, usage } = normalizeChatCompletion(providerId, completion);
    return {
      output: output as TOutput,
      usage,
      providerId,
      modelId: request.modelId,
      externalModelId: request.externalModelId,
      rawResponse: completion,
    };
  } catch (err) {
    throw normalizeProviderError(providerId, err);
  }
}

/** Streams one OpenAI-compatible chat completion as normalized chunks. */
export async function* streamOpenAICompatibleChat<TInput>(
  providerId: ProviderId,
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
  options: OpenAICompatibleOptions,
): AsyncIterable<ProviderStreamChunk> {
  const input = chatInputSchema.parse(request.input);
  const params = buildChatCompletionParams(request.externalModelId, input, options);
  try {
    const stream = await client.chat.completions.create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      { signal: resolveRequestSignal(request) },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: 'text-delta', text: delta };
      if (chunk.usage) {
        yield { type: 'usage', usage: tokenUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.total_tokens) };
      }
    }
    yield { type: 'done' };
  } catch (err) {
    throw normalizeProviderError(providerId, err);
  }
}

/** Deterministic rejection for actions a provider does not implement. */
export function unsupportedAction(providerId: ProviderId, actionId: string): ProviderError {
  return new ProviderError(providerId, 'unsupported_action', `${providerId} does not implement action ${actionId}`);
}
