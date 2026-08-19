import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embeddings';
import { IMAGE_CAPTION_EXTERNAL_MODEL_ID, IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import { createOpenAIProvider } from './openai';

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

test('preserves structured caption, cleanup, and visual identity contracts on direct OpenAI', async () => {
  const bodies: Record<string, any>[] = [];
  const outputs = [
    { results: [{ caption: 'A detailed scene.', score: 91 }] },
    { content: 'Clean document text.' },
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
  expect((await provider.execute({ ...base, actionId: 'document-cleanup', input: { text: 'Clean   document text.' } })).output).toEqual({ content: 'Clean document text.' });
  expect((await provider.execute({ ...base, actionId: 'describe-visual-identity', input: { imageUrls: ['https://cdn.example.com/dog.jpg'] } })).output).toEqual({ description: 'A black dog with a white chest blaze.' });
  expect(bodies.map(({ model }) => model)).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-luna']);
  expect(bodies.map(({ response_format }) => response_format.json_schema.name)).toEqual(['image_caption_results', 'document_cleanup', 'visual_identity_description']);
  expect(bodies.every((body) => !('provider' in body))).toBe(true);
});
