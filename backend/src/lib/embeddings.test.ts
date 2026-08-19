import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EXTERNAL_EMBEDDING_MODEL_ID, LEGACY_EMBEDDING_DIMENSIONS, embedText, embedTexts, embeddingMetadata, prepareEmbeddingText, rolloutEmbeddingSchema } from './embeddings';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const vector = (value: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
});

test('normalizes document and query text without model-specific instructions', () => {
  expect(prepareEmbeddingText('  hello  ', 'document')).toBe('hello');
  expect(prepareEmbeddingText('  hello  ', 'query')).toBe('hello');
  expect(embeddingMetadata()).toEqual({ embeddingProvider: 'openrouter', embeddingModel: EMBEDDING_MODEL, embeddingDimensions: EMBEDDING_DIMENSIONS });
  expect(EMBEDDING_MODEL).toBe('openai.text-embedding-3-small');
  expect(EXTERNAL_EMBEDDING_MODEL_ID).toBe('openai/text-embedding-3-small');
  expect(EMBEDDING_DIMENSIONS).toBe(1_536);
});

test('rollout reads accept finite legacy and current vectors only', () => {
  expect(rolloutEmbeddingSchema.safeParse(Array(LEGACY_EMBEDDING_DIMENSIONS).fill(0)).success).toBe(true);
  expect(rolloutEmbeddingSchema.safeParse(Array(EMBEDDING_DIMENSIONS).fill(0)).success).toBe(true);
  expect(rolloutEmbeddingSchema.safeParse(Array(2).fill(0)).success).toBe(false);
});

describe('batch embeddings', () => {
  test('uses one ordered batch and trims every query', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ provider: 'Azure', data: [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }] });
    }) as typeof fetch;

    const result = await embedTexts({ texts: [' first ', ' second '], purpose: 'query', timeoutMs: 5_000 });
    expect(body.input).toEqual(['first', 'second']);
    expect(body.model).toBe(EXTERNAL_EMBEDDING_MODEL_ID);
    expect(result[0]?.[0]).toBe(1);
    expect(result[1]?.[0]).toBe(2);
  });

  test('rejects incorrect response cardinality and every malformed vector', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    globalThis.fetch = (async () => Response.json({ provider: 'Azure', data: [{ index: 0, embedding: vector(1) }] })) as unknown as typeof fetch;
    await expect(embedTexts({ texts: ['one', 'two'] })).rejects.toBeDefined();

    globalThis.fetch = (async () => Response.json({ provider: 'Azure', data: [{ index: 0, embedding: vector(1) }, { index: 1, embedding: [1] }] })) as unknown as typeof fetch;
    await expect(embedTexts({ texts: ['one', 'two'] })).rejects.toBeDefined();
  });

  test('keeps embedText as a one-item wrapper', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    let input: unknown;
    globalThis.fetch = (async (_url, init) => {
      input = JSON.parse(String(init?.body)).input;
      return Response.json({ provider: 'Azure', data: [{ index: 0, embedding: vector(3) }] });
    }) as typeof fetch;
    expect((await embedText({ text: ' document ' }))[0]).toBe(3);
    expect(input).toEqual(['document']);
  });

  test('splits large requests into bounded provider batches while preserving order', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const sizes: number[] = [];
    let active = 0;
    let maxActive = 0;
    globalThis.fetch = (async (_url, init) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      sizes.push(input.length);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({ provider: 'Azure', data: input.map((text, index) => ({ index, embedding: vector(Number(text.slice(1))) })) });
    }) as typeof fetch;
    const result = await embedTexts({ texts: Array.from({ length: 33 }, (_, index) => `v${index}`) });
    expect(sizes).toEqual([16, 16, 1]);
    expect(maxActive).toBe(3);
    expect(result.map((embedding) => embedding[0])).toEqual(Array.from({ length: 33 }, (_, index) => index));
  });
});
