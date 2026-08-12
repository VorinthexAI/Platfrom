import { describe, expect, test } from 'bun:test';
import { IMAGE_CAPTION_MODEL } from '@/lib/image-caption-constants';
import { imageCreateVisualIdentityTool } from './image-create-visual-identity';

describe('image.create-visual-identity tool', () => {
  test('validates reference URLs and returns a detailed description', async () => {
    let received: unknown;
    const output = await imageCreateVisualIdentityTool.execute({ imageUrls: ['https://cdn.example.com/viggo-1.jpg', 'https://cdn.example.com/viggo-2.jpg'] }, {
      organizationKey: 'organization-key',
      executeDescription: async (organizationKey, input) => {
        received = { organizationKey, input };
        return { output: { description: 'A small black dog with a white chest blaze and a notch on the left ear.' } } as never;
      },
    });
    expect(received).toEqual({ organizationKey: 'organization-key', input: { imageUrls: ['https://cdn.example.com/viggo-1.jpg', 'https://cdn.example.com/viggo-2.jpg'] } });
    expect(output.description).toContain('white chest blaze');
    await expect(imageCreateVisualIdentityTool.execute({ imageUrls: ['file:///viggo.jpg'] }, { executeDescription: async () => ({}) as never })).rejects.toThrow('HTTP or HTTPS');
    await expect(imageCreateVisualIdentityTool.execute({ imageUrls: ['https://cdn.example.com/viggo.jpg'] }, { executeDescription: async () => ({}) as never })).rejects.toThrow('authorized organization');
  });

  test('pins execution to the Qwen vision model', async () => {
    const source = await Bun.file(new URL('./image-create-visual-identity.ts', import.meta.url)).text();
    expect(imageCreateVisualIdentityTool.name).toBe('image.create-visual-identity');
    expect(IMAGE_CAPTION_MODEL).toBe('qwen.qwen3-vl-32b-instruct');
    expect(source).toContain("actionSlug: 'describe-visual-identity'");
    expect(source).toContain("providerSlug: 'openrouter'");
  });
});
