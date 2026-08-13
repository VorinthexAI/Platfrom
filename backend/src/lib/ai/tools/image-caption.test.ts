import { describe, expect, test } from 'bun:test';
import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import { imageCaptionTool } from './image-caption';

describe('image.caption tool', () => {
  test('validates URLs and returns only ordered captions from the executor', async () => {
    let receivedOrganization = '';
    let receivedInput: unknown;
    const output = await imageCaptionTool.execute({
      imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
    }, {
      organizationKey: 'organization-key',
      async executeImageCaption(organizationKey, input) {
        receivedOrganization = organizationKey;
        receivedInput = input;
        return { output: { captions: ['First rich caption.', 'Second rich caption.'] } } as never;
      },
    });

    expect(receivedOrganization).toBe('organization-key');
    expect(receivedInput).toEqual({ imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'] });
    expect(output).toEqual({ captions: ['First rich caption.', 'Second rich caption.'] });
    await expect(imageCaptionTool.execute({ imageUrls: ['file:///private/image.jpg'] }, {
      executeImageCaption: async () => ({}) as never,
    })).rejects.toThrow('HTTP or HTTPS');
    await expect(imageCaptionTool.execute({ imageUrls: [], extra: true }, {
      executeImageCaption: async () => ({}) as never,
    })).rejects.toThrow();
  });

  test('pins default execution to the static OpenRouter Qwen vision route', async () => {
    const source = await Bun.file(new URL('./image-caption.ts', import.meta.url)).text();
    expect(imageCaptionTool.name).toBe('image.caption');
    expect(imageCaptionTool.providerDefinition.inputSchema.properties.imageUrls.items.pattern).toBe('^https?://');
    expect(source).toContain("mode: 'fixed'");
    expect(source).toContain("actionSlug: 'caption-image'");
    expect(source).toContain("providerSlug: 'openrouter'");
    expect(IMAGE_CAPTION_MODEL).toBe('qwen.qwen3-vl-32b-instruct');
  });

  test('rejects malformed executor output', async () => {
    await expect(imageCaptionTool.execute({ imageUrls: ['https://cdn.example.com/one.jpg'] }, {
      executeImageCaption: async () => ({ output: { captions: [''] } }) as never,
    })).rejects.toThrow();
    await expect(imageCaptionTool.execute({ imageUrls: ['https://cdn.example.com/one.jpg'] }, {
      executeImageCaption: async () => ({ output: { captions: ['one', 'two'] } }) as never,
    })).rejects.toThrow('caption count');
  });
});
