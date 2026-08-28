import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embeddings';
import { IMAGE_CAPTION_EXTERNAL_MODEL_ID, IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import { createOpenAIProvider } from './openai';

const png = 'iVBORw0KGgo=';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('supports direct OpenAI embeddings and the routed embed action', async () => {
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.25);
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ data: [{ index: 0, embedding: vector }], usage: { prompt_tokens: 2, total_tokens: 2 } });
  }) as typeof fetch;
  const provider = createOpenAIProvider({ apiKey: 'test-key' });
  expect((await provider.embed!({ externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: 'query', dimensions: EMBEDDING_DIMENSIONS })).embeddings).toEqual([vector]);
  const result = await provider.execute({ actionId: 'embed', modelId: 'openai.text-embedding-3-small', externalModelId: EXTERNAL_EMBEDDING_MODEL_ID, input: { text: 'query' }, organizationKey: 'organization' });
  expect(result.output).toEqual({ embedding: vector });
  expect(body).toEqual({ model: EXTERNAL_EMBEDDING_MODEL_ID, input: 'query', dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' });
});

test('preserves structured caption and visual identity contracts on direct OpenAI', async () => {
  const bodies: Record<string, any>[] = [];
  const outputs = [
    { results: [{ caption: 'A detailed scene.', score: 91 }] },
    { results: [{ caption: 'visible writing', score: 1 }] },
    { description: 'A black dog with a white chest blaze.' },
  ];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const content = JSON.stringify(outputs.shift());
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  }) as typeof fetch;
  const provider = createOpenAIProvider({ apiKey: 'test-key' });
  const base = { modelId: IMAGE_CAPTION_MODEL, externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID, organizationKey: 'organization' };
  expect((await provider.execute({ ...base, actionId: 'caption-image', input: { imageUrls: ['https://cdn.example.com/image.jpg'] } })).output).toEqual({ results: [{ caption: 'A detailed scene.', score: 91 }] });
  expect((await provider.execute({ ...base, actionId: 'caption-image', input: { imageUrls: ['https://cdn.example.com/art.jpg'], purpose: 'artwork-compliance' } })).output).toEqual({ results: [{ caption: 'visible writing', score: 1 }] });
  expect((await provider.execute({ ...base, actionId: 'describe-visual-identity', input: { imageUrls: ['https://cdn.example.com/dog.jpg'] } })).output).toEqual({ description: 'A black dog with a white chest blaze.' });
  expect(bodies.map(({ model }) => model)).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-luna']);
  expect(bodies.map(({ response_format }) => response_format.json_schema.name)).toEqual(['image_caption_results', 'image_caption_results', 'visual_identity_description']);
  expect(bodies[1].messages[0].content[0].text).toContain('no person or human-like subject, no visible writing');
  expect(bodies[1].messages[0].content[0].text).toContain('no botanical, fungal, or vegetation imagery');
  expect(bodies.every((body) => !('provider' in body))).toBe(true);
});

test('preserves direct OpenAI image generation with the extended contract', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return Response.json({ data: [{ b64_json: png }], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } });
  }) as typeof fetch;
  const result = await createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'generate-image', modelId: 'openai.gpt-image-2', externalModelId: 'gpt-image-2', input: { prompt: 'globe', count: 1, size: '1024x1024', quality: 'medium' }, organizationKey: 'organization' });
  expect(url).toBe('https://api.openai.com/v1/images/generations');
  expect(body).toMatchObject({ model: 'gpt-image-2', prompt: 'globe', n: 1, size: '1024x1024', quality: 'medium' });
  expect(result).toMatchObject({ output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, providerId: 'openai' });
});

test('chunks long speech deterministically and preserves exact numeric pace', async () => {
  const bodies: Array<{ input: string; speed: number }> = []; let responseIndex = 0;
  globalThis.fetch = (async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); const bytes = responseIndex++ === 0 ? new Uint8Array([1, 2]) : new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 3, 4]); return new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }); }) as typeof fetch;
  const text = Array(1_000).fill('word').join(' ');
  const result = await createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'generate-speech', modelId: 'openai.gpt-4o-mini-tts', externalModelId: 'gpt-4o-mini-tts', input: { text, voice: 'coral', pace: 1.37, format: 'mp3' }, organizationKey: 'organization' });
  expect(bodies.length).toBeGreaterThan(1); expect(bodies.every(({ input, speed }) => input.length <= 3_800 && speed === 1.37)).toBe(true);
  expect(bodies.flatMap(({ input }) => input.split(/\s+/))).toEqual(text.split(/\s+/));
  expect(Buffer.from((result.output as { base64: string }).base64, 'base64')).toEqual(Buffer.from([1, 2, 3, 4]));
});

test('propagates abort signals through speech requests', async () => {
  globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => { const signal = init?.signal; signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); })) as typeof fetch;
  const controller = new AbortController();
  const execution = createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'generate-speech', modelId: 'openai.gpt-4o-mini-tts', externalModelId: 'gpt-4o-mini-tts', input: { text: 'Narrate this.', voice: 'sage', pace: 0.83, format: 'mp3' }, organizationKey: 'organization', signal: controller.signal });
  await Promise.resolve(); controller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(execution).rejects.toMatchObject({ code: 'aborted' });
});

test('uses Responses web search and returns grounded text, citations, and sources', async () => {
  let url = '';
  let body: Record<string, any> = {};
  globalThis.fetch = (async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return Response.json({
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.japan.go.jp/' }] } },
        { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '{"title":"Japan"}', annotations: [{ type: 'url_citation', title: 'Government of Japan', url: 'https://www.japan.go.jp/', start_index: 0, end_index: 5 }] }] },
      ],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    });
  }) as typeof fetch;
  const result = await createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'web-search', modelId: 'openai.gpt-5.6-luna', externalModelId: 'gpt-5.6-luna', input: { prompt: 'Research Japan', responseFormat: { name: 'place_detail', schema: { type: 'object' } } }, organizationKey: 'organization' });
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(body).toMatchObject({
    model: 'gpt-5.6-luna',
    input: 'Research Japan',
    reasoning: { effort: 'low' },
    tool_choice: 'required',
    text: { format: { type: 'json_schema', name: 'place_detail', strict: true, schema: { type: 'object' } } },
    include: ['web_search_call.action.sources'],
    tools: [{ type: 'web_search', search_context_size: 'low', external_web_access: true }],
  });
  expect(result).toMatchObject({
    output: { text: '{"title":"Japan"}', citations: [{ title: 'Government of Japan', url: 'https://www.japan.go.jp/' }], sources: ['https://www.japan.go.jp/'] },
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    providerId: 'openai',
  });
});

test('rejects Responses output when web search did not complete', async () => {
  globalThis.fetch = (async () => Response.json({
    output: [
      { type: 'web_search_call', status: 'failed', action: { type: 'search' } },
      { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '{"title":"Japan"}', annotations: [] }] },
    ],
  })) as unknown as typeof fetch;
  const execution = createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'web-search', modelId: 'openai.gpt-5.6-luna', externalModelId: 'gpt-5.6-luna', input: { prompt: 'Research Japan' }, organizationKey: 'organization' });
  await expect(execution).rejects.toMatchObject({ code: 'response_invalid' });
});

async function expectUngroundedResponseRejected(sources: Array<{ type: string; url: string }>) {
  globalThis.fetch = (async () => Response.json({
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources } },
      { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Claim', annotations: [{ type: 'url_citation', title: 'Unrelated', url: 'https://example.com/citation', start_index: 0, end_index: 5 }] }] },
    ],
  })) as unknown as typeof fetch;
  const execution = createOpenAIProvider({ apiKey: 'test-key' }).execute({ actionId: 'web-search', modelId: 'openai.gpt-5.6-luna', externalModelId: 'gpt-5.6-luna', input: { prompt: 'Research Japan' }, organizationKey: 'organization' });
  await expect(execution).rejects.toMatchObject({ code: 'response_invalid' });
}

test('rejects Responses citations when returned search sources are empty', async () => {
  await expectUngroundedResponseRejected([]);
});

test('rejects Responses citations not grounded in returned search sources', async () => {
  await expectUngroundedResponseRejected([{ type: 'url', url: 'https://example.com/source' }]);
});

test('rejects truncated ask completions', async () => {
  globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: 'Partial answer' }, finish_reason: 'length' }] })) as unknown as typeof fetch;
  const execution = createOpenAIProvider({ apiKey: 'test-key' }).execute({
    actionId: 'ask',
    modelId: 'openai.gpt-5.6-luna',
    externalModelId: 'gpt-5.6-luna',
    input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Explain this fully.' }] }] },
    organizationKey: 'organization',
  });
  await expect(execution).rejects.toMatchObject({ code: 'response_invalid', providerId: 'openai' });
});
