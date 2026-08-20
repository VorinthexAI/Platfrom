import { describe, expect, test } from 'bun:test';
import { createOpenRouterProvider } from './openrouter';

const request = {
  actionId: 'generate-image' as const,
  modelId: 'bfl.flux-2-klein-4b',
  externalModelId: 'black-forest-labs/flux.2-klein-4b',
  input: { prompt: 'Japan at dawn', count: 1, aspectRatio: '3:2', outputFormat: 'png' },
  organizationKey: 'organization',
};

describe('OpenRouter provider', () => {
  test('generates normalized images through the dedicated image endpoint', async () => {
    let url = '', init: RequestInit | undefined;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async (input, options) => {
      url = String(input); init = options;
      return Response.json({ data: [{ b64_json: 'AQ==', media_type: 'image/png' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost: 0.015 } });
    }) as typeof fetch);
    const result = await provider.execute(request);
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(init?.headers).toEqual({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ model: request.externalModelId, prompt: 'Japan at dawn', n: 1, aspect_ratio: '3:2', output_format: 'png' });
    expect(result).toMatchObject({ output: { images: [{ base64: 'AQ==', mimeType: 'image/png' }] }, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, costUsd: 0.015, providerId: 'openrouter' });
  });

  test('infers the requested MIME type when OpenRouter omits media_type', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json({ data: [{ b64_json: 'AQ==' }] })) as unknown as typeof fetch);
    await expect(provider.execute(request)).resolves.toMatchObject({ output: { images: [{ mimeType: 'image/png' }] } });
  });

  test('rejects unsupported actions and normalizes HTTP errors', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'ask' })).rejects.toMatchObject({ code: 'unsupported_action', providerId: 'openrouter' });
    await expect(provider.execute(request)).rejects.toMatchObject({ code: 'rate_limited', providerId: 'openrouter', status: 429 });
  });
});
