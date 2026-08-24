import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { webSearchInputSchema, webSearchOutputSchema, type WebSearchOutput } from '@/lib/ai/actions/web-search';
import { normalizeProviderError, ProviderError } from './errors';
import { buildChatCompletionParams } from './openai-compatible';
import {
  imageGenerateInputSchema,
  imageOutputSchema,
  generatedImageMimeTypeSchema,
  chatInputSchema,
  chatOutputSchema,
  resolveRequestSignal,
  type ImageOutput,
  type ChatOutput,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type ProviderStreamChunk,
} from './types';

export const openRouterProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
}).strict();

export type OpenRouterProviderConfig = z.input<typeof openRouterProviderConfigSchema>;
export type OpenRouterCredentials = OpenRouterProviderConfig;

const PROVIDER_ID = 'openrouter' as const;
const imageResponseSchema = z.object({
  data: z.array(z.object({
    b64_json: z.string().min(1),
    media_type: generatedImageMimeTypeSchema.optional(),
  }).passthrough()),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();
const textResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
      tool_calls: z.array(z.object({
        id: z.string().min(1),
        type: z.literal('function'),
        function: z.object({ name: z.string().min(1), arguments: z.string() }).strict(),
      }).strict()).optional(),
      annotations: z.array(z.object({
        type: z.literal('url_citation'),
        url_citation: z.object({ url: z.string(), title: z.string() }).passthrough(),
      }).passthrough()).optional(),
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
    server_tool_use: z.object({ web_search_requests: z.number().int().nonnegative() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

async function requestChat(fetcher: typeof fetch, baseUrl: string, apiKey: string, body: object, request: ProviderExecuteRequest): Promise<unknown> {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: resolveRequestSignal(request),
  });
  if (!response.ok) throw Object.assign(new Error('OpenRouter text request failed'), { status: response.status });
  return response.json();
}

export function createOpenRouterProvider(config: OpenRouterProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (request.actionId === 'ask') {
        const parsedInput = chatInputSchema.safeParse(request.input);
        if (!parsedInput.success) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter chat input is invalid', { cause: parsedInput.error });
        const input = parsedInput.data;
        try {
          const body = buildChatCompletionParams(request.externalModelId, input, { maxTokensParam: 'max_tokens' }, PROVIDER_ID);
          const raw = await requestChat(fetcher, parsed.baseUrl, parsed.apiKey, body, request);
          const parsedResult = textResponseSchema.safeParse(raw);
          if (!parsedResult.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text response is invalid', { cause: parsedResult.error });
          const result = parsedResult.data;
          const choice = result.choices[0]!;
          if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter chat response did not complete normally');
          const parsedOutput = chatOutputSchema.safeParse({
            text: choice.message.content ?? '',
            toolCalls: (choice.message.tool_calls ?? []).map((call) => {
              let args: unknown = call.function.arguments;
              try { args = JSON.parse(call.function.arguments); } catch { /* Preserve malformed provider arguments for the caller. */ }
              return { id: call.id, name: call.function.name, arguments: args };
            }),
            stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason ?? null,
          });
          if (!parsedOutput.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter chat output is invalid', { cause: parsedOutput.error });
          const output: ChatOutput = parsedOutput.data;
          return {
            output: output as TOutput,
            usage: tokenUsage(result.usage?.prompt_tokens, result.usage?.completion_tokens, result.usage?.total_tokens),
            ...(result.usage?.cost !== undefined ? { costUsd: result.usage.cost } : {}),
            providerId: PROVIDER_ID,
            modelId: request.modelId,
            externalModelId: request.externalModelId,
            rawResponse: raw,
          };
        } catch (error) {
          throw normalizeProviderError(PROVIDER_ID, error);
        }
      }
      if (request.actionId === 'web-search') {
        const input = webSearchInputSchema.omit({ mode: true }).parse(request.input);
        try {
          const body: Record<string, unknown> = {
            model: request.externalModelId,
            messages: [{ role: 'user', content: input.prompt }],
            tools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_total_results: 10, max_uses: 2, search_context_size: 'low' } }],
            tool_choice: 'required',
            max_tool_calls: 2,
            max_tokens: 4_000,
            ...(input.responseFormat ? { response_format: { type: 'json_schema', json_schema: { name: input.responseFormat.name, strict: true, schema: input.responseFormat.schema } } } : {}),
          };
          const raw = await requestChat(fetcher, parsed.baseUrl, parsed.apiKey, body, request);
          const result = textResponseSchema.safeParse(raw);
          if (!result.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter web search response is invalid', { cause: result.error });
          const choice = result.data.choices[0]!;
          if (choice.finish_reason !== 'stop') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter web search response was truncated');
          if ((result.data.usage?.server_tool_use?.web_search_requests ?? 0) < 1) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter did not run web search');
          const citations = (choice.message.annotations ?? []).map(({ url_citation }) => ({ title: url_citation.title, url: url_citation.url }));
          if (citations.length === 0) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter web search returned no grounded citations');
          const parsedOutput = webSearchOutputSchema.safeParse({
            text: choice.message.content,
            citations: [...new Map(citations.map((citation) => [citation.url, citation])).values()],
            sources: [...new Set(citations.map(({ url }) => url))],
          });
          if (!parsedOutput.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter web search output is invalid', { cause: parsedOutput.error });
          const output: WebSearchOutput = parsedOutput.data;
          return { output: output as TOutput, usage: tokenUsage(result.data.usage?.prompt_tokens, result.data.usage?.completion_tokens, result.data.usage?.total_tokens), ...(result.data.usage?.cost !== undefined ? { costUsd: result.data.usage.cost } : {}), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
        } catch (error) {
          throw normalizeProviderError(PROVIDER_ID, error);
        }
      }
      if (request.actionId !== 'generate-image') throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenRouter does not support ${request.actionId}`);
      const input = imageGenerateInputSchema.parse(request.input);
      try {
        const response = await fetcher(`${parsed.baseUrl.replace(/\/$/, '')}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${parsed.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.externalModelId,
            prompt: input.prompt,
            n: input.count,
            ...(input.size ? { size: input.size } : {}),
            ...(input.resolution ? { resolution: input.resolution } : {}),
            ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
            ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
            ...(input.quality ? { quality: input.quality } : {}),
          }),
          signal: resolveRequestSignal(request),
        });
        if (!response.ok) throw Object.assign(new Error('OpenRouter image request failed'), { status: response.status });
        const raw: unknown = await response.json();
        const result = imageResponseSchema.parse(raw);
        if (result.data.length !== input.count) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter image generation returned an unexpected image count');
        const fallbackMimeType = input.outputFormat ? `image/${input.outputFormat}` : undefined;
        const output: ImageOutput = imageOutputSchema.parse({ images: result.data.map((image) => ({ base64: image.b64_json, mimeType: image.media_type ?? fallbackMimeType })) });
        return {
          output: output as TOutput,
          usage: tokenUsage(result.usage?.prompt_tokens, result.usage?.completion_tokens, result.usage?.total_tokens),
          ...(result.usage?.cost !== undefined ? { costUsd: result.usage.cost } : {}),
          providerId: PROVIDER_ID,
          modelId: request.modelId,
          externalModelId: request.externalModelId,
          rawResponse: raw,
        };
      } catch (error) {
        throw normalizeProviderError(PROVIDER_ID, error);
      }
    },
    async *stream<TInput>(request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
      if (request.actionId !== 'ask') throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenRouter does not support streaming ${request.actionId}`);
      const input = chatInputSchema.safeParse(request.input);
      if (!input.success) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter chat input is invalid', { cause: input.error });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const body = { ...buildChatCompletionParams(request.externalModelId, input.data, { maxTokensParam: 'max_tokens' }, PROVIDER_ID), stream: true, stream_options: { include_usage: true } };
        const response = await fetcher(`${parsed.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${parsed.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: resolveRequestSignal(request) });
        if (!response.ok) throw Object.assign(new Error('OpenRouter text stream failed'), { status: response.status });
        if (!response.body) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text stream has no body');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;
        let finishReason: string | null | undefined;
        stream: while (true) {
          const { value, done } = await reader.read();
          buffer += value ? decoder.decode(value, { stream: !done }) : done ? decoder.decode() : '';
          if (done && buffer.trim()) buffer += '\n\n';
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? '';
          for (const event of events) {
            const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
            if (!data) continue;
            if (data === '[DONE]') {
              completed = true;
              break stream;
            }
            let rawChunk: unknown;
            try { rawChunk = JSON.parse(data); }
            catch (error) { throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text stream returned malformed JSON', { cause: error }); }
            const parsedChunk = z.object({ choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional() }).passthrough(), finish_reason: z.string().nullable().optional() }).passthrough()), usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().nullable().optional() }).passthrough().safeParse(rawChunk);
            if (!parsedChunk.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text stream returned an invalid event', { cause: parsedChunk.error });
            const chunk = parsedChunk.data;
            const choice = chunk.choices[0];
            if (choice?.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
            const delta = choice?.delta.content;
            if (delta) yield { type: 'text-delta', text: delta };
            if (chunk.usage) yield { type: 'usage', usage: tokenUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.total_tokens) };
          }
          if (done) break;
        }
        if (buffer.trim() || !completed) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text stream ended before completion');
        if (finishReason !== 'stop') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter text stream did not complete normally');
        yield { type: 'done' };
      } catch (error) {
        throw normalizeProviderError(PROVIDER_ID, error);
      } finally {
        if (reader) {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
    },
  };
}

export const openRouterProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openRouterProviderConfigSchema,
  create(config) {
    return createOpenRouterProvider(openRouterProviderConfigSchema.parse(config));
  },
};
