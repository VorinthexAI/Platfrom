import OpenAI from 'openai';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import {
  CHAT_ACTION_IDS,
  executeOpenAICompatibleChat,
  streamOpenAICompatibleChat,
  unsupportedAction,
} from './openai-compatible';
import {
  imageGenerateInputSchema,
  resolveRequestSignal,
  speechInputSchema,
  transcribeInputSchema,
  type ImageOutput,
  type ProviderAdapter,
  type ProviderEmbedRequest,
  type ProviderEmbedResponse,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type SpeechOutput,
  type TranscriptionOutput,
} from './types';

export const openAIProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    organization: z.string().optional(),
    project: z.string().optional(),
  })
  .strict();

export type OpenAIProviderConfig = z.infer<typeof openAIProviderConfigSchema>;
export const openAICredentialsSchema = openAIProviderConfigSchema;
export type OpenAICredentials = OpenAIProviderConfig;

const PROVIDER_ID = 'openai' as const;

async function createEmbeddings(client: OpenAI, request: ProviderEmbedRequest): Promise<ProviderEmbedResponse> {
  try {
    const raw = await client.embeddings.create(
      {
        model: request.externalModelId,
        input: request.input,
        encoding_format: 'float',
        ...(request.dimensions ? { dimensions: request.dimensions } : {}),
      },
      { signal: resolveRequestSignal(request) },
    );
    const embeddings = [...raw.data]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
    if (embeddings.length === 0) {
      throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openai embeddings returned no vectors');
    }
    return {
      embeddings,
      usage: tokenUsage(raw.usage.prompt_tokens, 0, raw.usage.total_tokens),
      providerId: PROVIDER_ID,
      externalModelId: request.externalModelId,
      rawResponse: raw,
    };
  } catch (err) {
    throw normalizeProviderError(PROVIDER_ID, err);
  }
}

const imageResponseSchema = z.object({
  data: z
    .array(z.object({ b64_json: z.string().optional() }).passthrough())
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

async function executeImageGenerate<TInput, TOutput>(
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = imageGenerateInputSchema.parse(request.input);
  const raw = await client.images.generate(
    {
      model: request.externalModelId,
      prompt: input.prompt,
      n: input.count,
      ...(input.size ? { size: input.size } : {}),
    },
    { signal: resolveRequestSignal(request) },
  );
  const parsed = imageResponseSchema.parse(raw);
  const images = (parsed.data ?? [])
    .filter((item): item is { b64_json: string } => typeof item.b64_json === 'string' && item.b64_json.length > 0)
    .map((item) => ({ base64: item.b64_json, mimeType: 'image/png' }));
  if (images.length === 0) {
    throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openai image generation returned no images');
  }
  const output: ImageOutput = { images };
  return {
    output: output as TOutput,
    usage: tokenUsage(parsed.usage?.input_tokens, parsed.usage?.output_tokens, parsed.usage?.total_tokens),
    providerId: PROVIDER_ID,
    modelId: request.modelId,
    externalModelId: request.externalModelId,
    rawResponse: raw,
  };
}

async function executeTranscribe<TInput, TOutput>(
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = transcribeInputSchema.parse(request.input);
  const bytes = Buffer.from(input.audioBase64, 'base64');
  const extension = input.mimeType.split('/')[1] ?? 'webm';
  const file = new File([bytes], `audio.${extension}`, { type: input.mimeType });
  const raw = await client.audio.transcriptions.create(
    {
      file,
      model: request.externalModelId,
      ...(input.language ? { language: input.language } : {}),
    },
    { signal: resolveRequestSignal(request) },
  );
  const parsed = z.object({ text: z.string() }).passthrough().parse(raw);
  const output: TranscriptionOutput = { text: parsed.text };
  return {
    output: output as TOutput,
    usage: tokenUsage(0, 0, 0),
    providerId: PROVIDER_ID,
    modelId: request.modelId,
    externalModelId: request.externalModelId,
    rawResponse: raw,
  };
}

async function executeSpeech<TInput, TOutput>(
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = speechInputSchema.parse(request.input);
  const response = await client.audio.speech.create(
    {
      model: request.externalModelId,
      voice: input.voice,
      input: input.text,
      response_format: input.format,
    },
    { signal: resolveRequestSignal(request) },
  );
  const audio = Buffer.from(await response.arrayBuffer());
  const output: SpeechOutput = {
    audioBase64: audio.toString('base64'),
    mimeType: input.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
  };
  return {
    output: output as TOutput,
    usage: tokenUsage(0, 0, 0),
    providerId: PROVIDER_ID,
    modelId: request.modelId,
    externalModelId: request.externalModelId,
  };
}

export function createOpenAIProvider(config: OpenAIProviderConfig): ProviderAdapter {
  const parsed = openAIProviderConfigSchema.parse(config);
  const client = new OpenAI({
    apiKey: parsed.apiKey,
    baseURL: parsed.baseUrl,
    organization: parsed.organization,
    project: parsed.project,
  });

  return {
    id: PROVIDER_ID,
    name: 'OpenAI',

    async execute(request) {
      if (CHAT_ACTION_IDS.has(request.actionId)) {
        return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
      }
      try {
        if (request.actionId === 'generate-image') return await executeImageGenerate(client, request);
        if (request.actionId === 'transcribe') return await executeTranscribe(client, request);
        if (request.actionId === 'generate-speech') return await executeSpeech(client, request);
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
      throw unsupportedAction(PROVIDER_ID, request.actionId);
    },

    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
    },

    embed(request) {
      return createEmbeddings(client, request);
    },
  };
}

export const openAIProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openAIProviderConfigSchema,
  create(config) {
    return createOpenAIProvider(openAIProviderConfigSchema.parse(config));
  },
};
