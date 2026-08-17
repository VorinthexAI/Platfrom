import { afterEach, describe, expect, test } from 'bun:test';
import { IMAGE_CAPTION_EXTERNAL_MODEL_ID, IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import { createOpenRouterProvider } from './openrouter';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function completion(content: string) {
  return {
    id: 'completion-id',
    object: 'chat.completion',
    created: 1,
    model: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  };
}

describe('OpenRouter image captions', () => {
  test('cleans extracted document text with Gemini, strict output, and private routing', async () => {
    let body: Record<string, any> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion(JSON.stringify({ content: 'Faktura\n\nFakturans total är 42 €.' })));
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).execute({
      actionId: 'document-cleanup',
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { text: 'Fakturans   total ar 42 € . ###' },
      organizationKey: 'organization-key',
    });

    expect(body.model).toBe(IMAGE_CAPTION_EXTERNAL_MODEL_ID);
    expect(body.messages[0].content).toContain('original language or languages');
    expect(body.messages[0].content).toContain('polished plain text');
    expect(body.messages[0].content).toContain('meaningful punctuation');
    expect(body.messages[0].content).toContain('decorative symbol-only fragments');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Fakturans   total ar 42 € . ###' });
    expect(body.response_format.json_schema.name).toBe('document_cleanup');
    expect(body.provider).toEqual({ data_collection: 'deny', sort: 'throughput', require_parameters: true });
    expect(result.output).toEqual({ content: 'Faktura\n\nFakturans total är 42 €.' });
  });

  test('sends all images in one ordered multimodal request and returns scored results', async () => {
    let body: Record<string, any> = {};
    const inlineImage = 'data:image/jpeg;base64,/9j/2Q==';
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion(JSON.stringify({ results: [
        { caption: 'A detailed first scene.', score: 91 },
        { caption: 'A detailed second scene.', score: 74 },
      ] })));
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).execute({
      actionId: 'caption-image',
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { imageUrls: [inlineImage, 'https://cdn.example.com/two.jpg'] },
      organizationKey: 'organization-key',
    });

    expect(body.model).toBe(IMAGE_CAPTION_EXTERNAL_MODEL_ID);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.filter((part: { type: string }) => part.type === 'image_url')).toEqual([
      { type: 'image_url', image_url: { url: inlineImage, detail: 'auto' } },
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/two.jpg', detail: 'auto' } },
    ]);
    expect(body.messages[0].content[0].text).toContain('resolution, focus and clarity, lighting and exposure, visible detail, composition, and artifacts');
    expect(body.response_format.json_schema.name).toBe('image_caption_results');
    expect(body.response_format.json_schema.schema).toMatchObject({ required: ['results'], additionalProperties: false });
    expect(body.response_format.json_schema.schema.properties.results).toMatchObject({
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['caption', 'score'],
        additionalProperties: false,
        properties: { score: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    });
    expect(body.provider).toEqual({ data_collection: 'deny', sort: 'throughput', require_parameters: true });
    expect(body.provider).not.toHaveProperty('zdr');
    expect(result.output).toEqual({ results: [
      { caption: 'A detailed first scene.', score: 91 },
      { caption: 'A detailed second scene.', score: 74 },
    ] });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80, totalTokens: 200 });
  });

  test('builds a strict visual identity profile from multiple references', async () => {
    let body: Record<string, any> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion(JSON.stringify({ description: 'A black dog with a white chest blaze and a notch in the left ear.' })));
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).execute({
      actionId: 'describe-visual-identity',
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { imageUrls: ['https://cdn.example.com/viggo-1.jpg', 'https://cdn.example.com/viggo-2.jpg'] },
      organizationKey: 'organization-key',
    });

    expect(body.messages[0].content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(2);
    expect(body.messages[0].content[0].text).toContain('stable visible identifier');
    expect(body.response_format.json_schema.name).toBe('visual_identity_description');
    expect(body.provider).toEqual({ data_collection: 'deny', sort: 'throughput', require_parameters: true });
    expect(body.provider).not.toHaveProperty('zdr');
    expect(result.output).toEqual({ description: 'A black dog with a white chest blaze and a notch in the left ear.' });
  });

  test('rejects malformed output, mismatched cardinality, and the wrong model', async () => {
    const request = {
      actionId: 'caption-image' as const,
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { imageUrls: ['https://cdn.example.com/one.jpg'] },
      organizationKey: 'organization-key',
    };
    globalThis.fetch = (async () => Response.json(completion('{not-json'))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    globalThis.fetch = (async () => Response.json(completion(JSON.stringify({ results: [
      { caption: 'one', score: 80 },
      { caption: 'two', score: 70 },
    ] })))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    globalThis.fetch = (async () => Response.json(completion(JSON.stringify({ results: [{ caption: 'one', score: 80.5 }] })))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    globalThis.fetch = (async () => Response.json(completion(JSON.stringify({ results: [{ caption: 'one', score: 101 }] })))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    globalThis.fetch = (async () => Response.json(completion(JSON.stringify({ results: [{ caption: 'one', score: 80, extra: true }] })))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute({ ...request, externalModelId: 'other/model' })).rejects.toMatchObject({ code: 'unsupported_action' });
  });

  test('returns scored document transcription text in the unified result shape', async () => {
    let body: Record<string, any> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion(JSON.stringify({ results: [{ caption: 'Invoice total: 42 EUR', score: 83 }] })));
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).execute({
      actionId: 'caption-image',
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { imageUrls: ['https://cdn.example.com/document.jpg'], purpose: 'document-transcription' },
      organizationKey: 'organization-key',
    });

    expect(body.messages[0].content[0].text).toContain("caption field");
    expect(body.messages[0].content[0].text).toContain('legibility and quality');
    expect(result.output).toEqual({ results: [{ caption: 'Invoice total: 42 EUR', score: 83 }] });
  });

  test('rejects malformed document cleanup output and the wrong model', async () => {
    const request = {
      actionId: 'document-cleanup' as const,
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { text: 'Extracted body' },
      organizationKey: 'organization-key',
    };
    globalThis.fetch = (async () => Response.json(completion('{not-json'))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute({ ...request, externalModelId: 'other/model' })).rejects.toMatchObject({ code: 'unsupported_action' });
  });
});
