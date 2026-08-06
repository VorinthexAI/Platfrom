import OpenAI from 'openai';
import { z } from 'zod';

export const EMBEDDING_PROVIDER_ID = 'openai' as const;
export const EMBEDDING_MODEL = 'openai.text-embedding-3-small';
export const OPENAI_EMBEDDING_MODEL_ID = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1_536;

const MAX_RETRIES = 3;
const embedInputSchema = z.object({
  text: z.string().trim().min(1),
  signal: z.instanceof(AbortSignal).optional(),
}).strict();
const environmentSchema = z.object({
  apiKey: z.string({ required_error: 'OPENAI_API_KEY is required' }).trim().min(1, 'OPENAI_API_KEY is required'),
  baseURL: z.string().url().optional(),
  organization: z.string().trim().min(1).optional(),
  project: z.string().trim().min(1).optional(),
}).strict();
const responseSchema = z.object({
  data: z.array(z.object({
    index: z.literal(0),
    embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
  }).passthrough()).length(1),
}).passthrough();

export function embeddingMetadata() {
  return { embeddingProvider: EMBEDDING_PROVIDER_ID, embeddingModel: EMBEDDING_MODEL } as const;
}

/** Generates one fixed-size embedding; token-limit validation remains with OpenAI. */
export async function embedText(input: { text: string; signal?: AbortSignal }): Promise<number[]> {
  const parsedInput = embedInputSchema.parse(input);
  const config = environmentSchema.parse({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    organization: process.env.OPENAI_ORGANIZATION || undefined,
    project: process.env.OPENAI_PROJECT || undefined,
  });
  const client = new OpenAI({ ...config, maxRetries: MAX_RETRIES });
  const response = await client.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL_ID,
    input: parsedInput.text,
    dimensions: EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  }, { signal: parsedInput.signal });
  return responseSchema.parse(response).data[0]!.embedding;
}
