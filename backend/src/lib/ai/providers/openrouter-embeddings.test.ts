import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EMBEDDING_ROUTE, EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embeddings';
import { createOpenRouterProvider } from './openrouter';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const vector = (value: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);

describe('OpenRouter Qwen embeddings', () => {
  test('strictly routes direct embeddings to DeepInfra and restores indexed order', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ provider: 'DeepInfra', data: [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }], usage: { prompt_tokens: 4, total_tokens: 4 } });
    }) as typeof fetch;
    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: ['one', 'two'], dimensions: EMBEDDING_DIMENSIONS });
    expect(body).toEqual({ model: EXTERNAL_EMBEDDING_MODEL_ID, input: ['one', 'two'], dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float', provider: { order: [EMBEDDING_ROUTE], allow_fallbacks: false, data_collection: 'deny', zdr: true } });
    expect(result.embeddings[0]?.[0]).toBe(1);
    expect(result.embeddings[1]?.[0]).toBe(2);
  });

  test('supports the routed embed action and rejects malformed cardinality', async () => {
    globalThis.fetch = (async () => Response.json({ provider: 'DeepInfra', data: [{ index: 0, embedding: vector(1) }] })) as unknown as typeof fetch;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' });
    const result = await provider.execute({ actionId: 'embed', modelId: 'qwen.qwen3-embedding-8b', externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: { text: 'query' }, organizationKey: 'organization' });
    expect(result.output).toEqual({ embedding: vector(1) });
    globalThis.fetch = (async () => Response.json({ provider: 'DeepInfra', data: [{ index: 1, embedding: vector(1) }] })) as unknown as typeof fetch;
    await expect(provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'bad' })).rejects.toMatchObject({ code: 'response_invalid' });
  });

  test('retries normalized transient failures and rejects invalid dimensions', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) return new Response(null, { status: 503, headers: { 'retry-after-ms': '5' } });
      return Response.json({ provider: 'DeepInfra', data: [{ index: 0, embedding: vector(1) }] });
    }) as unknown as typeof fetch;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' });
    await expect(provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'retry' })).resolves.toBeDefined();
    expect(attempts).toBe(2);
    globalThis.fetch = (async () => Response.json({ provider: 'DeepInfra', data: [{ index: 0, embedding: [1] }] })) as unknown as typeof fetch;
    await expect(provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'bad dimensions' })).rejects.toMatchObject({ code: 'response_invalid' });
  });

  test('aborts bounded retry backoff immediately', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const controller = new AbortController();
    const request = createOpenRouterProvider({ apiKey: 'test-key' }).embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'abort', signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(request).rejects.toMatchObject({ code: 'aborted' });
  });

  test('does not retry authentication failures and accepts bounded Retry-After date/seconds', async () => {
    let attempts = 0;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' });
    for (const status of [400, 401, 403]) {
      attempts = 0;
      globalThis.fetch = (async () => { attempts += 1; return new Response(null, { status }); }) as unknown as typeof fetch;
      await expect(provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: `status ${status}` })).rejects.toBeDefined();
      expect(attempts).toBe(1);
    }

    attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) return new Response(null, { status: 429, headers: { 'retry-after': new Date(Date.now() - 1_000).toUTCString() } });
      if (attempts === 2) return new Response(null, { status: 408, headers: { 'retry-after': '0' } });
      return Response.json({ provider: 'DeepInfra', data: [{ index: 0, embedding: vector(1) }] });
    }) as unknown as typeof fetch;
    await expect(provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'retry headers' })).resolves.toBeDefined();
    expect(attempts).toBe(3);
  });
});
