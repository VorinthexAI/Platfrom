import { z } from 'zod';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_ID,
  EXTERNAL_EMBEDDING_MODEL_ID,
  LEGACY_EMBEDDING_DIMENSIONS,
  QWEN_RETRIEVAL_INSTRUCTION,
} from './embedding-constants';

export * from './embedding-constants';

const embeddingRequestOptionsSchema = z.object({
  purpose: z.enum(['document', 'query']).default('document'),
  signal: z.instanceof(AbortSignal).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const inputSchema = embeddingRequestOptionsSchema.extend({
  text: z.string().trim().min(1),
}).strict();

const batchInputSchema = embeddingRequestOptionsSchema.extend({
  texts: z.array(z.string().trim().min(1)).min(1),
}).strict();

export type EmbeddingPurpose = 'document' | 'query';
export interface EmbedTextInput { text: string; purpose?: EmbeddingPurpose; signal?: AbortSignal; timeoutMs?: number }
export interface EmbedTextsInput { texts: string[]; purpose?: EmbeddingPurpose; signal?: AbortSignal; timeoutMs?: number }

export const currentEmbeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);
export const currentEmbeddingBatchSchema = z.array(currentEmbeddingSchema).min(1);
export const rolloutEmbeddingSchema = z.array(z.number().finite()).superRefine((embedding, context) => {
  if (embedding.length !== EMBEDDING_DIMENSIONS && embedding.length !== LEGACY_EMBEDDING_DIMENSIONS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Embedding must contain ${EMBEDDING_DIMENSIONS} or legacy ${LEGACY_EMBEDDING_DIMENSIONS} dimensions.` });
  }
});

export function embeddingMetadata() {
  return {
    embeddingProvider: EMBEDDING_PROVIDER_ID,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  } as const;
}

export function prepareEmbeddingText(text: string, purpose: EmbeddingPurpose): string {
  const value = text.trim();
  if (purpose === 'query' && !value.startsWith(QWEN_RETRIEVAL_INSTRUCTION)) return `${QWEN_RETRIEVAL_INSTRUCTION}${value}`;
  return value;
}

export async function embedTexts(input: EmbedTextsInput): Promise<number[][]> {
  const parsed = batchInputSchema.parse(input);
  const { createOpenRouterProvider, resolveOpenRouterEnvironment } = await import('@/lib/ai/providers/openrouter');
  const adapter = createOpenRouterProvider(resolveOpenRouterEnvironment(process.env));
  const prepared = parsed.texts.map((text) => prepareEmbeddingText(text, parsed.purpose));
  const embeddings: number[][] = [];
  for (let start = 0; start < prepared.length; start += 16) {
    const batch = prepared.slice(start, start + 16);
    const response = await adapter.embed!({
      externalModelId: EXTERNAL_EMBEDDING_MODEL_ID,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
      signal: parsed.signal,
      timeoutMs: parsed.timeoutMs,
    });
    if (response.embeddings.length !== batch.length) {
      throw new Error(`Embedding provider returned ${response.embeddings.length} vectors for ${batch.length} texts.`);
    }
    embeddings.push(...response.embeddings.map((embedding) => currentEmbeddingSchema.parse(embedding)));
  }
  return currentEmbeddingBatchSchema.parse(embeddings);
}

export async function embedText(input: EmbedTextInput): Promise<number[]> {
  const parsed = inputSchema.parse(input);
  const embeddings = await embedTexts({
    texts: [parsed.text],
    purpose: parsed.purpose,
    signal: parsed.signal,
    timeoutMs: parsed.timeoutMs,
  });
  return embeddings[0]!;
}
