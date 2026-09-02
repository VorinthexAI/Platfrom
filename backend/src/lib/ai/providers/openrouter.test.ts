import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { createOpenRouterProvider, openRouterProviderConfigSchema, splitOpenRouterSpeechText } from './openrouter';
import type { ProviderExecuteRequest } from './types';

function request(actionId: ProviderExecuteRequest['actionId'], input: unknown, externalModelId = 'vendor/model'): ProviderExecuteRequest {
  return { actionId, modelId: `openrouter.${externalModelId}`, externalModelId, input, organizationKey: 'org' };
}
const chatInput = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] };
function mp3Frame() { const frame = new Uint8Array(417); frame.set([0xff, 0xfb, 0x90, 0x64]); return frame; }

describe('OpenRouter provider', () => {
  test('validates config and sends attribution, strict JSON schema, tools, and exact model', async () => {
    expect(() => openRouterProviderConfigSchema.parse({})).toThrow();
    let url = ''; let headers: Headers; let body: any;
    const provider = createOpenRouterProvider({ apiKey: 'secret', appUrl: 'https://vorinthex.com/app', appName: 'Vorinthex Test' }, (async (target, init) => {
      url = String(target); headers = new Headers(init?.headers); body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'weather', arguments: '{"city":"Oslo"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0.001 } });
    }) as typeof fetch);
    const result = await provider.execute(request('text', { ...chatInput, tools: [{ name: 'weather', description: 'Weather', inputSchema: { type: 'object' } }], responseFormat: { name: 'answer', schema: { type: 'object', additionalProperties: false } } }, 'anthropic/claude'));
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers!.get('authorization')).toBe('Bearer secret');
    expect(headers!.get('HTTP-Referer')).toBe('https://vorinthex.com/app');
    expect(headers!.get('X-OpenRouter-Title')).toBe('Vorinthex Test');
    expect(body).toMatchObject({ model: 'anthropic/claude', response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } }, tools: [{ type: 'function' }] });
    expect(result).toMatchObject({ output: { toolCalls: [{ id: 'call-1', name: 'weather', arguments: { city: 'Oslo' } }], stopReason: 'tool_use' }, usage: { totalTokens: 6 }, costUsd: 0.001, providerId: 'openrouter' });
  });

  test('pins the flash-lite text model to its upstream provider without fallbacks and leaves other models unpinned', async () => {
    const bodies: any[] = [];
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (_target, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }) as typeof fetch);
    await provider.execute(request('text', chatInput, 'google/gemini-3.1-flash-lite'));
    await provider.execute(request('text', chatInput, 'vendor/model'));
    expect(bodies[0]).toMatchObject({ model: 'google/gemini-3.1-flash-lite', provider: { order: ['google-vertex/us'], allow_fallbacks: false } });
    expect(bodies[1].provider).toBeUndefined();
  });

  test('normalizes grounded web annotations and enables bounded native server search', async () => {
    let body: any;
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (_target, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: 'Current answer', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/news', title: 'News' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
    }) as typeof fetch);
    const result = await provider.execute(request('web', { prompt: 'What changed?' }));
    expect(body).toMatchObject({ model: 'vendor/model', tools: [{ type: 'openrouter:web_search', parameters: { engine: 'native', max_results: 5, max_uses: 2, max_total_results: 10 } }], max_tool_calls: 2 });
    expect(body.plugins).toBeUndefined();
    expect(result.output).toEqual({ text: 'Current answer', citations: [{ title: 'News', url: 'https://example.com/news' }], sources: ['https://example.com/news'] });
  });

  test('orders and validates batch embeddings through embed and execute', async () => {
    const vector = (value: number) => Array(EMBEDDING_DIMENSIONS).fill(value);
    const bodies: any[] = [];
    const provider = createOpenRouterProvider({ apiKey: 'key', baseUrl: 'https://gateway.test/v1/' }, (async (target, init) => {
      expect(String(target)).toBe('https://gateway.test/v1/embeddings'); bodies.push(JSON.parse(String(init?.body)));
      const input = bodies.at(-1).input as string | string[];
      return Response.json({ data: Array.isArray(input) && input.length === 2 ? [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }] : [{ index: 0, embedding: vector(1) }], usage: { prompt_tokens: 5, total_tokens: 5 } });
    }) as typeof fetch);
    const batch = await provider.embed!({ externalModelId: 'openai/embed', input: ['one', 'two'] });
    expect(bodies[0]).toEqual({ model: 'openai/embed', input: ['one', 'two'], encoding_format: 'float', dimensions: 1536 });
    expect(batch.embeddings.map((item) => item[0])).toEqual([1, 2]);
    const executed = await provider.execute(request('embed', { text: 'one two' }, 'openai/embed'));
    expect((executed.output as { embedding: number[] }).embedding[0]).toBe(1);
  });

  test('generates one image with edit references, normalized media, usage, and cost', async () => {
    let body: any; const png = 'aW1hZ2U=';
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (target, init) => {
      expect(String(target)).toEndWith('/images'); body = JSON.parse(String(init?.body));
      return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.04 } });
    }) as typeof fetch);
    const result = await provider.execute(request('image', { operation: 'generate', prompt: 'Watercolor', count: 1, aspectRatio: '16:9', outputFormat: 'png', inputReferences: ['https://example.com/input.png'] }, 'openai/gpt-image'));
    expect(body).toMatchObject({ model: 'openai/gpt-image', n: 1, aspect_ratio: '16:9', output_format: 'png', input_references: [{ type: 'image_url', image_url: { url: 'https://example.com/input.png' } }] });
    expect(result).toMatchObject({ output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: { totalTokens: 3 }, costUsd: 0.04 });
    await expect(provider.execute(request('image', { operation: 'generate', prompt: 'Two', count: 2 }))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  test('accepts fenced structured image analysis output', async () => {
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (_target, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('google/image');
      expect(body.messages[0].content[0].text).toContain('Respond with only valid JSON');
      expect(body.messages[0].content).toContainEqual({ type: 'image_url', image_url: { url: 'https://example.com/image.png' } });
      return Response.json({ choices: [{ message: { content: '```json\n{"results":[{"caption":"A red square","score":90}]}\n```' }, finish_reason: 'stop' }] });
    }) as typeof fetch);
    const result = await provider.execute(request('image', { operation: 'caption', imageUrls: ['https://example.com/image.png'], purpose: 'caption' }, 'google/image'));
    expect(result.output).toEqual({ results: [{ caption: 'A red square', score: 90 }] });
  });

  test('streams text and usage across fragmented SSE chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]')); controller.close(); } });
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (_target, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch);
    const chunks = []; for await (const chunk of provider.stream!(request('text', chatInput))) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' }, { type: 'usage', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } }, { type: 'done' }]);
  });

  test('assembles strict streamed tool-call argument fragments', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"agent.query","arguments":"{\\"query\\":\\"prior"}}]}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" context\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]'));
      controller.close();
    } });
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (_target, _init) => new Response(stream, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch);
    const chunks = []; for await (const chunk of provider.stream!(request('text', { ...chatInput, tools: [{ name: 'agent.query', description: 'History', inputSchema: { type: 'object' } }] }))) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'tool-call', toolCall: { id: 'call-1', name: 'agent.query', arguments: { query: 'prior context' } } }, { type: 'done' }]);
  });

  test('orders streamed tool calls by index and rejects malformed completion semantics', async () => {
    const responseStream = (body: string) => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } });
    const providerFor = (body: string) => createOpenRouterProvider({ apiKey: 'key' }, (async () => new Response(responseStream(body), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch);
    const collect = async (body: string) => { const chunks = []; for await (const chunk of providerFor(body).stream!(request('text', chatInput))) chunks.push(chunk); return chunks; };
    const ordered = []; for await (const chunk of providerFor('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"second","arguments":"{}"}},{"index":0,"id":"a","function":{"name":"first","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]').stream!(request('text', chatInput))) ordered.push(chunk);
    expect(ordered).toEqual([{ type: 'tool-call', toolCall: { id: 'a', name: 'first', arguments: {} } }, { type: 'tool-call', toolCall: { id: 'b', name: 'second', arguments: {} } }, { type: 'done' }]);
    await expect(collect('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]')).rejects.toThrow('finish reason');
    await expect(collect('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]')).rejects.toThrow('incomplete streamed tool call');
    await expect(collect('data: {bad}\n\ndata: [DONE]')).rejects.toThrow('malformed stream JSON');
  });

  test('maps voices, splits speech, and concatenates only valid MP3 frames', async () => {
    const bodies: any[] = []; const frame = mp3Frame();
    const provider = createOpenRouterProvider({ apiKey: 'key' }, (async (target, init) => {
      expect(String(target)).toEndWith('/audio/speech'); bodies.push(JSON.parse(String(init?.body)));
      const withMetadata = new Uint8Array(frame.length + 3); withMetadata.set([1, 2, 3]); withMetadata.set(frame, 3);
      return new Response(withMetadata, { headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch);
    const text = `First. ${'a'.repeat(15_001)}`;
    const result = await provider.execute(request('speech', { text, language: 'English', voice: 'coral', pace: 1.25, format: 'mp3' }, 'x-ai/grok-voice'));
    expect(bodies.length).toBe(3);
    expect(bodies[0]).toEqual({ model: 'x-ai/grok-voice', input: 'First.', voice: 'eve', response_format: 'mp3' });
    expect(Buffer.from((result.output as { base64: string }).base64, 'base64').length).toBe(frame.length * 3);
    expect(splitOpenRouterSpeechText('x'.repeat(30_001))).toHaveLength(3);
  });

  test('normalizes HTTP, abort, timeout, and malformed provider responses without leaking keys', async () => {
    const errors = createOpenRouterProvider({ apiKey: 'super-secret' }, (async () => Response.json({ error: { code: 429, message: 'super-secret capacity' } }, { status: 429 })) as unknown as typeof fetch);
    try { await errors.execute(request('text', chatInput)); throw new Error('expected failure'); } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limited', status: 429, message: 'OpenRouter text request failed with status 429' });
      expect(String((error as Error).cause)).not.toContain('super-secret');
    }
    const aborted = createOpenRouterProvider({ apiKey: 'key' }, (async () => { const error = new Error('abort'); error.name = 'AbortError'; throw error; }) as unknown as typeof fetch);
    await expect(aborted.execute(request('text', chatInput))).rejects.toMatchObject({ code: 'aborted' });
    const timedOut = createOpenRouterProvider({ apiKey: 'key' }, (async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; }) as unknown as typeof fetch);
    await expect(timedOut.execute({ ...request('text', chatInput), timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' });
    const malformed = createOpenRouterProvider({ apiKey: 'key' }, (async () => Response.json({ choices: [] })) as unknown as typeof fetch);
    await expect(malformed.execute(request('text', chatInput))).rejects.toMatchObject({ code: 'response_invalid' });
  });
});
