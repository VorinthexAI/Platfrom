import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { ASK_ACTION_IDS, unsupportedAction } from './openai-compatible';
import {
  chatInputSchema,
  resolveRequestSignal,
  type ChatInput,
  type ChatOutput,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
} from './types';

/**
 * Google Vertex AI, called over REST. Two auth shapes are supported:
 * - `apiKey`: Vertex AI express mode (`?key=` on the global endpoint).
 * - `accessToken` + `projectId`: standard OAuth bearer against the
 *   project/location endpoint. Token refresh is the caller's concern —
 *   this module never stores long-lived credentials.
 */
export const googleVertexProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    location: z.string().min(1).default('us-central1'),
  })
  .strict()
  .refine((config) => Boolean(config.apiKey) || Boolean(config.accessToken && config.projectId), {
    message: 'google-vertex requires either apiKey (express mode) or accessToken + projectId',
  });

export type GoogleVertexProviderConfig = z.infer<typeof googleVertexProviderConfigSchema>;
export const googleVertexCredentialsSchema = googleVertexProviderConfigSchema;
export type GoogleVertexCredentials = GoogleVertexProviderConfig;

const PROVIDER_ID = 'google-vertex' as const;

const generateContentResponseSchema = z.object({
  candidates: z
    .array(
      z
        .object({
          content: z
            .object({
              parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
            })
            .passthrough()
            .optional(),
          finishReason: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

interface VertexContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

function buildGenerateContentBody(input: ChatInput): Record<string, unknown> {
  const contents: VertexContent[] = [];
  const systemParts: string[] = input.system ? [input.system] : [];
  for (const message of input.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }
  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) body.systemInstruction = { parts: systemParts.map((text) => ({ text })) };
  const generationConfig: Record<string, unknown> = {};
  if (input.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = input.maxOutputTokens;
  if (input.temperature !== undefined) generationConfig.temperature = input.temperature;
  if (input.responseFormat?.type === 'json') generationConfig.responseMimeType = 'application/json';
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}

function buildEndpoint(config: GoogleVertexProviderConfig, externalModelId: string): { url: string; headers: Record<string, string> } {
  const model = encodeURIComponent(externalModelId);
  if (config.accessToken && config.projectId) {
    const host = `https://${config.location}-aiplatform.googleapis.com`;
    return {
      url: `${host}/v1/projects/${encodeURIComponent(config.projectId)}/locations/${config.location}/publishers/google/models/${model}:generateContent`,
      headers: { Authorization: `Bearer ${config.accessToken}` },
    };
  }
  return {
    url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey ?? '')}`,
    headers: {},
  };
}

export function createGoogleVertexProvider(config: GoogleVertexProviderConfig): ProviderAdapter {
  const parsed = googleVertexProviderConfigSchema.parse(config);

  return {
    id: PROVIDER_ID,
    name: 'Google Vertex AI',

    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (!ASK_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      const input = chatInputSchema.parse(request.input);
      const { url, headers } = buildEndpoint(parsed, request.externalModelId);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(buildGenerateContentBody(input)),
          signal: resolveRequestSignal(request),
        });
        if (!response.ok) {
          throw new ProviderError(
            PROVIDER_ID,
            providerErrorCodeForStatus(response.status),
            `google-vertex request failed with status ${response.status}`,
            { status: response.status },
          );
        }
        const raw: unknown = await response.json();
        const parsedResponse = generateContentResponseSchema.parse(raw);
        const candidate = parsedResponse.candidates?.[0];
        if (!candidate) {
          throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no candidates');
        }
        const text = (candidate.content?.parts ?? [])
          .map((part) => part.text ?? '')
          .join('');
        const output: ChatOutput = { text, toolCalls: [], stopReason: candidate.finishReason ?? null };
        return {
          output: output as TOutput,
          usage: tokenUsage(
            parsedResponse.usageMetadata?.promptTokenCount,
            parsedResponse.usageMetadata?.candidatesTokenCount,
            parsedResponse.usageMetadata?.totalTokenCount,
          ),
          providerId: PROVIDER_ID,
          modelId: request.modelId,
          externalModelId: request.externalModelId,
          rawResponse: raw,
        };
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
    },
  };
}

export const googleVertexProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: googleVertexProviderConfigSchema,
  create(config) {
    return createGoogleVertexProvider(googleVertexProviderConfigSchema.parse(config));
  },
};
