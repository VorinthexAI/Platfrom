import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedText, embeddingMetadata, OPENAI_EMBEDDING_MODEL_ID } from './openai-embeddings';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
  OPENAI_PROJECT: process.env.OPENAI_PROJECT,
};
const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS);

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('OpenAI embeddings', () => {
  test('requires valid OpenAI credentials and non-empty text', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(embedText({ text: 'hello' })).rejects.toThrow('OPENAI_API_KEY is required');
    process.env.OPENAI_API_KEY = 'test-key';
    await expect(embedText({ text: '  ' })).rejects.toThrow();
  });

  test('requests the fixed model and 3072 dimensions with optional client configuration', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://openai.example/v1';
    process.env.OPENAI_ORGANIZATION = 'org';
    process.env.OPENAI_PROJECT = 'project';
    let request: Request | undefined;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      request = new Request(input, init);
      return Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: vector }], model: OPENAI_EMBEDDING_MODEL_ID, usage: { prompt_tokens: 1, total_tokens: 1 } });
    }) as unknown as typeof fetch;

    await expect(embedText({ text: 'Backend Developer' })).resolves.toEqual(vector);
    expect(request?.url).toBe('https://openai.example/v1/embeddings');
    expect(request?.headers.get('openai-organization')).toBe('org');
    expect(request?.headers.get('openai-project')).toBe('project');
    await expect(request?.json()).resolves.toEqual({ model: OPENAI_EMBEDDING_MODEL_ID, input: 'Backend Developer', dimensions: 3_072, encoding_format: 'float' });
    expect(embeddingMetadata()).toEqual({ embeddingProvider: 'openai', embeddingModel: EMBEDDING_MODEL });
  });

  test('retries rate limits, transient server responses, and network errors', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      if (requests === 1) return new Response('busy', { status: 429, headers: { 'retry-after-ms': '1' } });
      if (requests === 2) return new Response('unavailable', { status: 503 });
      if (requests === 3) throw new TypeError('temporary network failure');
      return Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: vector }], model: OPENAI_EMBEDDING_MODEL_ID, usage: { prompt_tokens: 1, total_tokens: 1 } });
    }) as unknown as typeof fetch;
    await expect(embedText({ text: 'retry me' })).resolves.toEqual(vector);
    expect(requests).toBe(4);

    globalThis.fetch = (async () => Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 2] }], model: OPENAI_EMBEDDING_MODEL_ID, usage: { prompt_tokens: 1, total_tokens: 1 } })) as unknown as typeof fetch;
    await expect(embedText({ text: 'wrong dimensions' })).rejects.toThrow();
  });

  test('passes abort signals through to active requests', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const controller = new AbortController();
    const request = embedText({ text: 'cancel me', signal: controller.signal });
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(request).rejects.toThrow('Request was aborted');
  });
});
