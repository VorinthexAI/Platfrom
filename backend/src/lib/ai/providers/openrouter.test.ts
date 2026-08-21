import { describe, expect, test } from 'bun:test';
import type { ProviderStreamChunk } from './types';
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
      actionId: 'ask',
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
    await expect(provider.execute({ ...request, actionId: 'caption-image' })).rejects.toMatchObject({ code: 'unsupported_action', providerId: 'openrouter' });
    await expect(provider.execute(request)).rejects.toMatchObject({ code: 'rate_limited', providerId: 'openrouter', status: 429 });
  });

  test('strictly validates text inputs and outputs', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json({ choices: [{ message: { content: '' } }] })) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }], unknown: true } })).rejects.toMatchObject({ code: 'invalid_input', providerId: 'openrouter' });
    await expect(provider.execute({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }] } })).rejects.toMatchObject({ code: 'response_invalid', providerId: 'openrouter' });
  });

  test('rejects truncated text completions', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json({ choices: [{ message: { content: 'Shanghai skyline at dusk' }, finish_reason: 'length' }] })) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Prompt' }] }] } })).rejects.toMatchObject({ code: 'response_invalid', providerId: 'openrouter' });
  });

  test('normalizes tool calls without forwarding canonical mode metadata', async () => {
    let body: Record<string, unknown> = {};
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'place.list', arguments: '{"limit":5}' } }] }, finish_reason: 'tool_calls' }] });
    }) as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'List places' }] }] } })).resolves.toMatchObject({ output: { text: '', toolCalls: [{ id: 'call-1', name: 'place.list', arguments: { limit: 5 } }], stopReason: 'tool_use' } });
    expect(body).not.toHaveProperty('mode');
  });

  test('attributes incompatible chat content to OpenRouter', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => { throw new Error('fetch should not run'); }) as unknown as typeof fetch);
    await expect(provider.execute({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'audio', artifactKey: 'audio-1', format: 'wav' }] }] } })).rejects.toMatchObject({ code: 'unsupported_action', providerId: 'openrouter' });
  });

  test('runs bounded Exa server web search and normalizes grounded citations', async () => {
    let body: any;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: '{"answer":"Tokyo"}', annotations: [{ type: 'url_citation', url_citation: { title: 'Japan Guide', url: 'https://example.com/tokyo' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, server_tool_use: { web_search_requests: 1 } } });
    }) as typeof fetch);
    const result = await provider.execute({ ...request, actionId: 'web-search', input: { prompt: 'Current Tokyo facts', responseFormat: { name: 'answer', schema: { type: 'object' } } } });
    expect(body.tools).toEqual([{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_total_results: 10, max_uses: 2, search_context_size: 'low' } }]);
    expect(body).toMatchObject({ tool_choice: 'required', max_tool_calls: 2, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } } });
    expect(body).not.toHaveProperty('plugins');
    expect(result.output).toEqual({ text: '{"answer":"Tokyo"}', citations: [{ title: 'Japan Guide', url: 'https://example.com/tokyo' }], sources: ['https://example.com/tokyo'] });
  });

  test('rejects unsearched, ungrounded, truncated, and non-HTTPS web search responses', async () => {
    const execute = (raw: unknown) => createOpenRouterProvider({ apiKey: 'test-key' }, (async () => Response.json(raw)) as unknown as typeof fetch).execute({ ...request, actionId: 'web-search', input: { prompt: 'Current facts' } });
    const grounded = { message: { content: 'Facts', annotations: [{ type: 'url_citation', url_citation: { title: 'Source', url: 'https://example.com' } }] }, finish_reason: 'stop' };
    await expect(execute({ choices: [grounded], usage: { server_tool_use: { web_search_requests: 0 } } })).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(execute({ choices: [{ message: { content: 'Facts', annotations: [] }, finish_reason: 'stop' }], usage: { server_tool_use: { web_search_requests: 1 } } })).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(execute({ choices: [{ ...grounded, finish_reason: 'length' }], usage: { server_tool_use: { web_search_requests: 1 } } })).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(execute({ choices: [{ message: { content: 'Facts', annotations: [{ type: 'url_citation', url_citation: { title: 'Source', url: 'http://example.com' } }] }, finish_reason: 'stop' }], usage: { server_tool_use: { web_search_requests: 1 } } })).rejects.toMatchObject({ code: 'response_invalid' });
  });

  test('streams text, usage, and done while forwarding abort and timeout signals', async () => {
    let init: RequestInit | undefined;
    const sse = ['data: {"choices":[{"delta":{"content":"Hello "}}]}', '', 'data: {"choices":[{"delta":{"content":"world"}}]}', '', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}', '', 'data: [DONE]', ''].join('\n');
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async (_input, options) => { init = options; return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }); }) as typeof fetch);
    const chunks = await Array.fromAsync(provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, timeoutMs: 5_000, signal: new AbortController().signal }));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'Hello ' }, { type: 'text-delta', text: 'world' }, { type: 'usage', usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } }, { type: 'done' }]);
  });

  test('rejects incomplete streams after preserving already emitted text', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n';
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => new Response(sse)) as unknown as typeof fetch);
    const chunks: ProviderStreamChunk[] = [];
    await expect((async () => {
      for await (const chunk of provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } })) chunks.push(chunk);
    })()).rejects.toMatchObject({ code: 'response_invalid' });
    expect(chunks).toEqual([{ type: 'text-delta', text: 'Partial' }]);
  });

  test('rejects truncated streams even when OpenRouter sends done', async () => {
    const sse = ['data: {"choices":[{"delta":{"content":"Partial"}}]}', '', 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}', '', 'data: [DONE]', ''].join('\n');
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => new Response(sse)) as unknown as typeof fetch);
    await expect(Array.fromAsync(provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } }))).rejects.toMatchObject({ code: 'response_invalid' });
  });

  test('stops and cancels the response body immediately after done', async () => {
    let cancelled = false;
    const bytes = new TextEncoder().encode(['data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}', '', 'data: [DONE]', '', ''].join('\n'));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, cancel() { cancelled = true; } });
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, (async () => new Response(body)) as unknown as typeof fetch);
    await expect(Array.fromAsync(provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } }))).resolves.toEqual([{ type: 'text-delta', text: 'Complete' }, { type: 'done' }]);
    expect(cancelled).toBe(true);
  });

  test('normalizes caller aborts and timeouts during streaming', async () => {
    const waitingFetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else {
        const watchdog = setTimeout(() => reject(new Error('abort signal did not fire')), 100);
        signal?.addEventListener('abort', () => { clearTimeout(watchdog); reject(signal.reason); }, { once: true });
      }
    })) as typeof fetch;
    const provider = createOpenRouterProvider({ apiKey: 'test-key' }, waitingFetch);
    const controller = new AbortController();
    const aborted = Array.fromAsync(provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, signal: controller.signal }));
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(aborted).rejects.toMatchObject({ code: 'aborted' });
    await expect(Array.fromAsync(provider.stream!({ ...request, actionId: 'ask', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, timeoutMs: 1 }))).rejects.toMatchObject({ code: 'timeout' });
  });
});
