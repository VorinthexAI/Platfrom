import { z } from 'zod';
import { openAIProviderFactory } from '@/lib/ai/providers/openai';
import type { ProviderAdapter } from '@/lib/ai/providers/types';

export const embedInputSchema = z.object({ text: z.string().min(1) }).strict();

export const EMBEDDING_PROVIDER_ID = 'openai' as const;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function getEmbeddingModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingMetadata(env: Record<string, string | undefined> = process.env) {
  return { embeddingProvider: EMBEDDING_PROVIDER_ID, embeddingModel: getEmbeddingModel(env) } as const;
}

interface EmbedOptions {
  provider?: ProviderAdapter;
  env?: Record<string, string | undefined>;
}

let cachedOpenAIProvider: ProviderAdapter | null | undefined;

function getDefaultOpenAIProvider(): ProviderAdapter | null {
  if (cachedOpenAIProvider === undefined) cachedOpenAIProvider = openAIProviderFactory.fromEnv(process.env);
  return cachedOpenAIProvider;
}

/** Generates embeddings through the canonical OpenAI provider adapter. */
export async function embed(input: z.infer<typeof embedInputSchema>, options: EmbedOptions = {}): Promise<number[]> {
  const parsed = embedInputSchema.parse(input);
  const env = options.env ?? process.env;
  const provider = options.provider ?? (options.env ? openAIProviderFactory.fromEnv(options.env) : getDefaultOpenAIProvider());
  if (!provider?.embed) {
    throw new Error('OpenAI embedding provider is unavailable. Configure OPENAI_API_KEY.');
  }
  const response = await provider.embed({ externalModelId: getEmbeddingModel(env), input: parsed.text });
  const vector = response.embeddings[0];
  if (!vector || vector.length === 0) throw new Error('OpenAI embedding provider returned no vector.');
  return vector;
}
