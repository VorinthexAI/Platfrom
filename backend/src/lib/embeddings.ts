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

const inputSchema = z.object({
  text: z.string().trim().min(1),
  purpose: z.enum(['document', 'query']).default('document'),
  signal: z.instanceof(AbortSignal).optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export const currentEmbeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);
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

export function prepareEmbeddingText(text: string, purpose: 'document' | 'query'): string {
  const value = text.trim();
  if (purpose === 'query' && !value.startsWith(QWEN_RETRIEVAL_INSTRUCTION)) return `${QWEN_RETRIEVAL_INSTRUCTION}${value}`;
  return value;
}

export async function embedText(input: { text: string; purpose?: 'document' | 'query'; signal?: AbortSignal; timeoutMs?: number }): Promise<number[]> {
  const parsed = inputSchema.parse(input);
  const { createOpenRouterProvider, resolveOpenRouterEnvironment } = await import('@/lib/ai/providers/openrouter');
  const adapter = createOpenRouterProvider(resolveOpenRouterEnvironment(process.env));
  const response = await adapter.embed!({
    externalModelId: EXTERNAL_EMBEDDING_MODEL_ID,
    input: prepareEmbeddingText(parsed.text, parsed.purpose),
    dimensions: EMBEDDING_DIMENSIONS,
    signal: parsed.signal,
    timeoutMs: parsed.timeoutMs,
  });
  return currentEmbeddingSchema.parse(response.embeddings[0]);
}
