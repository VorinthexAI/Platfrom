import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenRouterProvider, OPENROUTER_GPT_IMAGE_2_MODEL, OPENROUTER_IMAGE_DEFAULT_TIMEOUT_MS, OPENROUTER_IMAGE_MAX_TIMEOUT_MS } from './openrouter';

const originalFetch = globalThis.fetch;
const png = 'iVBORw0KGgo=';
const request = {
  actionId: 'generate-image' as const,
  modelId: 'openai.gpt-image-2',
  externalModelId: OPENROUTER_GPT_IMAGE_2_MODEL,
  input: { prompt: 'A blue interactive globe', size: '1536x1024' as const, count: 1, quality: 'high' as const },
  organizationKey: 'organization',
};

afterEach(() => { globalThis.fetch = originalFetch; });

describe('OpenRouter dedicated Images API', () => {
  test('forwards controls with strict OpenAI-only routing and normalizes usage and provider cost', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    let headers: Headers | undefined;
    globalThis.fetch = (async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.13 } });
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'secret', siteUrl: 'https://vorinthex.com', appName: 'Vorinthex' }).execute(request);
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(headers?.get('authorization')).toBe('Bearer secret');
    expect(headers?.get('http-referer')).toBe('https://vorinthex.com');
    expect(headers?.get('x-title')).toBe('Vorinthex');
    expect(body).toEqual({ model: OPENROUTER_GPT_IMAGE_2_MODEL, prompt: request.input.prompt, n: 1, size: '1536x1024', quality: 'high', provider: { only: ['openai'], allow_fallbacks: false } });
    expect(result).toMatchObject({ output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 }, costUsd: 0.13, providerId: 'openrouter', modelId: request.modelId, externalModelId: OPENROUTER_GPT_IMAGE_2_MODEL });
  });

  test('uses a long bounded timeout and honors caller cancellation', async () => {
    expect(OPENROUTER_IMAGE_DEFAULT_TIMEOUT_MS).toBe(180_000);
    expect(OPENROUTER_IMAGE_MAX_TIMEOUT_MS).toBe(300_000);
    const controller = new AbortController();
    globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const pending = createOpenRouterProvider({ apiKey: 'secret' }).execute({ ...request, timeoutMs: 600_000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  test('rejects wrong models, failed responses, counts, base64, and media mismatches', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'secret' });
    await expect(provider.execute({ ...request, externalModelId: 'openai/gpt-image-1' })).rejects.toMatchObject({ code: 'unsupported_action' });

    globalThis.fetch = (async () => new Response(null, { status: 429 })) as unknown as typeof fetch;
    await expect(provider.execute(request)).rejects.toMatchObject({ code: 'rate_limited', status: 429 });

    for (const response of [
      { data: [] },
      { data: [{ b64_json: png, media_type: 'image/png' }, { b64_json: png, media_type: 'image/png' }] },
      { data: [{ b64_json: 'not-base64', media_type: 'image/png' }] },
      { data: [{ b64_json: png, media_type: 'image/jpeg' }] },
      { data: [{ b64_json: png, media_type: 'application/octet-stream' }] },
      { data: [{ b64_json: png, media_type: 'image/png' }], usage: { cost: -1 } },
    ]) {
      globalThis.fetch = (async () => Response.json(response)) as unknown as typeof fetch;
      await expect(provider.execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    }
  });

  test('omits optional controls and cost when the provider omits them', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ data: [{ b64_json: png }] }); }) as typeof fetch;
    const result = await createOpenRouterProvider({ apiKey: 'secret' }).execute({ ...request, input: { prompt: 'globe' } });
    expect(body).toEqual({ model: OPENROUTER_GPT_IMAGE_2_MODEL, prompt: 'globe', n: 1, provider: { only: ['openai'], allow_fallbacks: false } });
    expect(result).not.toHaveProperty('costUsd');
    expect(result.output).toEqual({ images: [{ base64: png, mimeType: 'image/png' }] });
  });

  test('rejects an oversized declared response before parsing JSON', async () => {
    let parsed = false;
    globalThis.fetch = (async () => {
      const response = new Response('{"data":[]}', { headers: { 'content-length': String(16 * 1024 * 1024 + 64 * 1024 + 1) } });
      response.json = async () => { parsed = true; return { data: [] }; };
      return response;
    }) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'secret' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    expect(parsed).toBe(false);
  });
});
