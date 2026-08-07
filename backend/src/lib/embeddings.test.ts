import { expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, QWEN_RETRIEVAL_INSTRUCTION, embeddingMetadata, prepareEmbeddingText, rolloutEmbeddingSchema } from './embeddings';

test('applies the Qwen retrieval instruction exactly once only to queries', () => {
  expect(prepareEmbeddingText('hello', 'document')).toBe('hello');
  expect(prepareEmbeddingText('hello', 'query')).toBe(`${QWEN_RETRIEVAL_INSTRUCTION}hello`);
  expect(prepareEmbeddingText(`${QWEN_RETRIEVAL_INSTRUCTION}hello`, 'query')).toBe(`${QWEN_RETRIEVAL_INSTRUCTION}hello`);
  expect(embeddingMetadata()).toEqual({ embeddingProvider: 'openrouter', embeddingModel: EMBEDDING_MODEL, embeddingDimensions: EMBEDDING_DIMENSIONS });
});

test('rollout reads accept finite legacy and current vectors only', () => {
  expect(rolloutEmbeddingSchema.safeParse(Array(1_536).fill(0)).success).toBe(true);
  expect(rolloutEmbeddingSchema.safeParse(Array(EMBEDDING_DIMENSIONS).fill(0)).success).toBe(true);
  expect(rolloutEmbeddingSchema.safeParse(Array(2).fill(0)).success).toBe(false);
});
