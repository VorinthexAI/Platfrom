import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import {
  imageGenerateInputSchema,
  imageOutputSchema,
  generatedImageMimeTypeSchema,
  resolveRequestSignal,
  type ImageOutput,
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
const responseSchema = z.object({
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

export function createOpenRouterProvider(config: OpenRouterProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
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
        const result = responseSchema.parse(raw);
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
