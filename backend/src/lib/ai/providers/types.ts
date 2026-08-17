import { z } from 'zod';
import { actionIdSchema, type ActionId } from '@/lib/ai/actions/types';
import { coreChatInputSchema, coreChatMessageSchema, coreChatToolDefinitionSchema, type CoreChatInput, type CoreChatMessage, type CoreChatToolDefinition } from '@/lib/ai/actions/core-chat';
import { organizationKeySchema } from '@/lib/ai/shared/ids';
import type { TokenUsage } from '@/lib/ai/shared/usage';
import { MAX_IMAGE_CAPTION_URLS } from '@/lib/image-caption-constants';

/**
 * Every provider the execution layer can route through. There are no
 * provider categories (direct/cloud/gateway/...) — from the Vorinthex
 * runtime perspective all of these are simply providers.
 */
export const PROVIDER_SLUGS = [
  'openai',
  'anthropic',
  'xai',
  'google-vertex',
  'azure-ai-foundry',
  'aws-bedrock',
  'aws-bedrock-mantle',
  'aws-polly',
  'aws-transcribe',
  'openrouter',
] as const;

export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];
export type ProviderId = ProviderSlug;

export const providerSlugSchema = z.enum(PROVIDER_SLUGS);
export const providerIdSchema = providerSlugSchema;

/**
 * Human-readable display name per provider. Static (unlike the adapter
 * `name`, which lives on runtime-constructed instances behind secrets) so
 * persistence and migrations can stamp names without touching adapters.
 */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  'google-vertex': 'Google Vertex AI',
  'azure-ai-foundry': 'Azure AI Foundry',
  'aws-bedrock': 'AWS Bedrock',
  'aws-bedrock-mantle': 'AWS Bedrock Mantle',
  'aws-polly': 'AWS Polly',
  'aws-transcribe': 'AWS Transcribe',
  openrouter: 'OpenRouter',
};

/**
 * Normalized request every adapter receives. `modelId` is the INTERNAL
 * model id — typed as a plain string here because the provider layer sits
 * below the model registry in the dependency order (models import provider
 * ids, never the reverse); the router always passes a validated `ModelId`.
 */
export interface ProviderExecuteRequest<TInput = unknown> {
  actionId: ActionId;
  modelId: string;
  externalModelId: string;
  input: TInput;
  organizationKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const providerExecuteRequestSchema = z.object({
  actionId: actionIdSchema,
  modelId: z.string().min(1),
  externalModelId: z.string().min(1),
  input: z.unknown(),
  organizationKey: organizationKeySchema,
  timeoutMs: z.number().int().positive().optional(),
  signal: z.instanceof(AbortSignal).optional(),
});

export interface ProviderExecuteResponse<TOutput = unknown> {
  output: TOutput;
  usage: TokenUsage;
  providerId: ProviderId;
  modelId: string;
  externalModelId: string;
  rawResponse?: unknown;
}

export type ProviderStreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done' };

export interface ProviderHealth {
  providerId: ProviderId;
  healthy: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface ProviderEmbedRequest {
  externalModelId: string;
  input: string | string[];
  dimensions?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderEmbedResponse {
  embeddings: number[][];
  usage: TokenUsage;
  providerId: ProviderId;
  externalModelId: string;
  rawResponse?: unknown;
}

/** The common contract every provider module implements. */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;

  execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>>;

  stream?<TInput>(request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk>;

  embed?(request: ProviderEmbedRequest): Promise<ProviderEmbedResponse>;

  healthCheck?(): Promise<ProviderHealth>;
}

/**
 * The registry holds factories, never adapters constructed at module import
 * time. Callers supply validated credentials when creating an adapter.
 */
export interface ProviderFactory {
  readonly id: ProviderId;
  readonly configSchema: z.ZodTypeAny;
  create(config: unknown): ProviderAdapter;
}

// ---------------------------------------------------------------------------
// Normalized action inputs/outputs. Providers validate `input` against the
// schema for the requested action — unknown external data is `unknown`
// until parsed, never cast.
// ---------------------------------------------------------------------------

/** Compatibility aliases for the provider layer; the core action owns these schemas. */
export const chatMessageSchema = coreChatMessageSchema;
export type ChatMessage = CoreChatMessage;
export const chatToolSchema = coreChatToolDefinitionSchema;
export type ChatTool = CoreChatToolDefinition;
export const chatInputSchema = coreChatInputSchema;
export type ChatInput = CoreChatInput;

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatOutput {
  text: string;
  toolCalls: NormalizedToolCall[];
  stopReason: string | null;
}

export const imageGenerateInputSchema = z
  .object({
    prompt: z.string().min(1),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
    count: z.number().int().min(1).max(4).default(1),
  })
  .strict();

export type ImageGenerateInput = z.infer<typeof imageGenerateInputSchema>;

export interface ImageOutput {
  images: Array<{ base64: string; mimeType: string }>;
}

const httpImageUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Image URL must use HTTP or HTTPS');
const inlineImageUrlSchema = z.string().max(28 * 1024 * 1024).regex(/^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, 'Inline image URL is invalid');

export const imageCaptionInputSchema = z.object({
  imageUrls: z.array(z.union([httpImageUrlSchema, inlineImageUrlSchema])).min(1).max(MAX_IMAGE_CAPTION_URLS),
  purpose: z.enum(['caption', 'document-transcription', 'document-reconciliation']).default('caption'),
  referenceTexts: z.array(z.object({ primary: z.string().max(40_000), secondary: z.string().max(40_000) }).strict()).min(1).max(MAX_IMAGE_CAPTION_URLS).optional(),
}).strict().superRefine((input, context) => {
  if (input.purpose === 'document-reconciliation' && input.referenceTexts?.length !== input.imageUrls.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['referenceTexts'], message: 'Reconciliation requires one text pair per image.' });
  if (input.purpose !== 'document-reconciliation' && input.referenceTexts !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['referenceTexts'], message: 'Reference texts are only valid for document reconciliation.' });
});
export type ImageCaptionInput = z.infer<typeof imageCaptionInputSchema>;

export const imageCaptionOutputSchema = z.object({
  results: z.array(z.object({
    caption: z.string().trim().min(1).max(20_000),
    score: z.number().int().min(1).max(100),
  }).strict()).min(1).max(MAX_IMAGE_CAPTION_URLS),
}).strict();
export type ImageCaptionOutput = z.infer<typeof imageCaptionOutputSchema>;

export const documentCleanupInputSchema = z.object({
  text: z.string().trim().min(1).max(16_000),
}).strict();
export type DocumentCleanupInput = z.infer<typeof documentCleanupInputSchema>;

export const documentCleanupOutputSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
}).strict();
export type DocumentCleanupOutput = z.infer<typeof documentCleanupOutputSchema>;

export const visualIdentityDescriptionInputSchema = z.object({
  imageUrls: z.array(z.union([httpImageUrlSchema, inlineImageUrlSchema])).min(1).max(8),
}).strict();
export type VisualIdentityDescriptionInput = z.infer<typeof visualIdentityDescriptionInputSchema>;

export const visualIdentityDescriptionOutputSchema = z.object({
  description: z.string().trim().min(1).max(12_000),
}).strict();
export type VisualIdentityDescriptionOutput = z.infer<typeof visualIdentityDescriptionOutputSchema>;

export const transcribeInputSchema = z
  .object({
    audioBase64: z.string().min(1),
    mimeType: z.string().min(1),
    language: z.string().optional(),
    prompt: z.string().max(4_000).optional(),
  })
  .strict();

export type TranscribeInput = z.infer<typeof transcribeInputSchema>;

export interface TranscriptionOutput {
  text: string;
}

export const speechInputSchema = z
  .object({
    text: z.string().min(1),
    voice: z.string().default('alloy'),
    format: z.enum(['mp3', 'wav']).default('mp3'),
    language: z.string().trim().min(1).max(120).optional(),
    speakingRate: z.number().min(0.25).max(4).optional(),
  })
  .strict();

export type SpeechInput = z.infer<typeof speechInputSchema>;

export interface SpeechOutput {
  audioBase64: string;
  mimeType: string;
}

export const embeddingInputSchema = z.object({ text: z.string().min(1) }).strict();
export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export interface EmbeddingOutput { embedding: number[]; }

/**
 * Combines the request's abort signal with its timeout into one signal
 * suitable for fetch/SDK calls. Returns undefined when neither is set.
 */
export function resolveRequestSignal(request: Pick<ProviderExecuteRequest, 'signal' | 'timeoutMs'>): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (request.signal) signals.push(request.signal);
  if (request.timeoutMs !== undefined) signals.push(AbortSignal.timeout(request.timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
