import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
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
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

export function createOpenRouterProvider(config: OpenRouterProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (request.actionId === 'chat') {
        const parsedInput = chatInputSchema.safeParse(request.input);
        if (!parsedInput.success) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter chat input is invalid', { cause: parsedInput.error });
        const input = parsedInput.data;
        try {
          const body = buildChatCompletionParams(request.externalModelId, input, { maxTokensParam: 'max_tokens' }, PROVIDER_ID);
          const response = await fetcher(`${parsed.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${parsed.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: resolveRequestSignal(request),
          });
          if (!response.ok) throw Object.assign(new Error('OpenRouter text request failed'), { status: response.status });
          const raw: unknown = await response.json();
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
            stopReason: choice.finish_reason ?? null,
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
  };
}

export const openRouterProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openRouterProviderConfigSchema,
  create(config) {
    return createOpenRouterProvider(openRouterProviderConfigSchema.parse(config));
  },
};
