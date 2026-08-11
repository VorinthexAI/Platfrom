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
  test('sends all images in one ordered multimodal request and returns captions only', async () => {
    let body: Record<string, any> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(completion(JSON.stringify({ captions: ['A detailed first scene.', 'A detailed second scene.'] })));
    }) as typeof fetch;

    const result = await createOpenRouterProvider({ apiKey: 'test-key' }).execute({
      actionId: 'caption-image',
      modelId: IMAGE_CAPTION_MODEL,
      externalModelId: IMAGE_CAPTION_EXTERNAL_MODEL_ID,
      input: { imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'] },
      organizationKey: 'organization-key',
    });

    expect(body.model).toBe(IMAGE_CAPTION_EXTERNAL_MODEL_ID);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.filter((part: { type: string }) => part.type === 'image_url')).toEqual([
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/one.jpg', detail: 'high' } },
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/two.jpg', detail: 'high' } },
    ]);
    expect(body.response_format.json_schema.schema.properties.captions).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(body.provider).toEqual({ data_collection: 'deny', zdr: true });
    expect(result.output).toEqual({ captions: ['A detailed first scene.', 'A detailed second scene.'] });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80, totalTokens: 200 });
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
    globalThis.fetch = (async () => Response.json(completion(JSON.stringify({ captions: ['one', 'two'] })))) as unknown as typeof fetch;
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute(request)).rejects.toMatchObject({ code: 'response_invalid' });
    await expect(createOpenRouterProvider({ apiKey: 'test-key' }).execute({ ...request, externalModelId: 'other/model' })).rejects.toMatchObject({ code: 'unsupported_action' });
  });
});
