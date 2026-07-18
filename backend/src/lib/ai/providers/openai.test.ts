import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAIProvider } from './openai';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAI provider embeddings', () => {
  test('uses the embeddings API and normalizes vectors in input order', async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        object: 'list',
        model: 'text-embedding-3-small',
        data: [
          { object: 'embedding', index: 1, embedding: [0, 1] },
          { object: 'embedding', index: 0, embedding: [1, 0] },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    }) as typeof fetch;

    const provider = createOpenAIProvider({ apiKey: 'test-key' });
    const response = await provider.embed?.({
      externalModelId: 'text-embedding-3-small',
      input: ['first', 'second'],
    });

    expect(requestBody).toEqual({
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
      encoding_format: 'float',
    });
    expect(response?.embeddings).toEqual([[1, 0], [0, 1]]);
    expect(response?.usage).toEqual({ inputTokens: 4, outputTokens: 0, totalTokens: 4 });
  });
});
