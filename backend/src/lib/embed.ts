import { z } from 'zod';
import { openAIProviderFactory } from '@/lib/ai/providers/openai';
import type { ProviderAdapter } from '@/lib/ai/providers/types';

export const embedInputSchema = z.object({ text: z.string().min(1) }).strict();

export const EMBEDDING_PROVIDER_ID = 'openai' as const;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_CHUNK_CHARACTERS = 4_000;

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
  const characters = [...parsed.text];
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += EMBEDDING_CHUNK_CHARACTERS) {
    chunks.push(characters.slice(index, index + EMBEDDING_CHUNK_CHARACTERS).join(''));
  }
  const response = await provider.embed({
    externalModelId: getEmbeddingModel(env),
    input: chunks.length === 1 ? chunks[0]! : chunks,
  });
  if (response.embeddings.length !== chunks.length || response.embeddings.some((vector) => vector.length === 0)) {
    throw new Error('OpenAI embedding provider returned an invalid vector count.');
  }
  if (response.embeddings.length === 1) return response.embeddings[0]!;

  const dimensions = response.embeddings[0]!.length;
  if (response.embeddings.some((vector) => vector.length !== dimensions)) {
    throw new Error('OpenAI embedding provider returned inconsistent vector dimensions.');
  }
  const averaged = Array.from({ length: dimensions }, (_, dimension) =>
    response.embeddings.reduce((sum, vector) => sum + vector[dimension]!, 0) / response.embeddings.length);
  const norm = Math.sqrt(averaged.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? averaged : averaged.map((value) => value / norm);
}
