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
  test('generates normalized chat through chat completions', async () => {
    let url = '', init: RequestInit | undefined;
    const provider = createOpenRouterProvider({ apiKey: 'test-key', baseUrl: 'https://openrouter.test/v1/' }, (async (input, options) => {
      url = String(input); init = options;
      return Response.json({ choices: [{ message: { content: '  Kyoto balances temples and modern neighborhoods.  ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.00012 } });
    }) as typeof fetch);
    const controller = new AbortController();
    const result = await provider.execute({
      actionId: 'chat',
      modelId: 'google.gemini-2.5-flash-lite',
      externalModelId: 'google/gemini-2.5-flash-lite',
      input: { systemPrompt: 'Write grounded destination copy.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe Kyoto.' }] }], options: { maxTokens: 800, temperature: 0.3 } },
      organizationKey: 'organization',
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(url).toBe('https://openrouter.test/v1/chat/completions');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: 'Write grounded destination copy.' },
        { role: 'user', content: 'Describe Kyoto.' },
      ],
      max_tokens: 800,
      temperature: 0.3,
    });
    expect(result).toMatchObject({ output: { text: '  Kyoto balances temples and modern neighborhoods.  ', toolCalls: [], stopReason: 'stop' }, usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, costUsd: 0.00012, providerId: 'openrouter' });
  });

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

  test('strictly validates text inputs and outputs', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json({ choices: [{ message: { content: '' } }] })) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'chat', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }], unknown: true } })).rejects.toMatchObject({ code: 'invalid_input', providerId: 'openrouter' });
    await expect(provider.execute({ ...request, actionId: 'chat', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }] } })).rejects.toMatchObject({ code: 'response_invalid', providerId: 'openrouter' });
  });

  test('rejects truncated text completions', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json({ choices: [{ message: { content: 'Shanghai skyline at dusk' }, finish_reason: 'length' }] })) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'chat', input: { mode: 'deep', messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }] } })).rejects.toMatchObject({ code: 'response_invalid', providerId: 'openrouter' });
  });

  test('normalizes tool calls without forwarding canonical mode metadata', async () => {
    let body: Record<string, unknown> = {};
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'place.list', arguments: '{"limit":5}' } }] }, finish_reason: 'tool_calls' }] });
    }) as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'chat', input: { mode: 'default', messages: [{ role: 'user', content: [{ type: 'text', text: 'List places' }] }] } })).resolves.toMatchObject({ output: { text: '', toolCalls: [{ id: 'call-1', name: 'place.list', arguments: { limit: 5 } }], stopReason: 'tool_calls' } });
    expect(body).not.toHaveProperty('mode');
  });

  test('attributes incompatible chat content to OpenRouter', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => { throw new Error('fetch should not run'); }) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'chat', input: { messages: [{ role: 'user', content: [{ type: 'audio', artifactKey: 'audio-1', format: 'wav' }] }] } })).rejects.toMatchObject({ code: 'unsupported_action', providerId: 'openrouter' });
  });
});
