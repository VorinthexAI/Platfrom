import { describe, expect, test } from 'bun:test';
import { imageCreateVisualIdentityTool } from './image-create-visual-identity';

describe('image.create-visual-identity tool', () => {
  test('validates reference URLs and returns a detailed description', async () => {
    let received: unknown;
    const output = await imageCreateVisualIdentityTool.execute({ imageUrls: ['https://cdn.example.com/viggo-1.jpg', 'https://cdn.example.com/viggo-2.jpg'] }, {
      teamKey: 'team-key',
      executeDescription: async (teamKey, input) => {
        received = { teamKey, input };
        return { output: { description: 'A small black dog with a white chest blaze and a notch on the left ear.' } } as never;
      },
    });
    expect(received).toEqual({ teamKey: 'team-key', input: { imageUrls: ['https://cdn.example.com/viggo-1.jpg', 'https://cdn.example.com/viggo-2.jpg'] } });
    expect(output.description).toContain('white chest blaze');
    const inline = 'data:image/jpeg;base64,/9j/2Q==';
    await expect(imageCreateVisualIdentityTool.execute({ imageUrls: [inline] }, { teamKey: 'team-key', executeDescription: async (_teamKey, input) => ({ output: { description: input.imageUrls[0] } }) as never })).resolves.toEqual({ description: inline });
    await expect(imageCreateVisualIdentityTool.execute({ imageUrls: ['file:///viggo.jpg'] }, { executeDescription: async () => ({}) as never })).rejects.toThrow('HTTP or HTTPS');
    await expect(imageCreateVisualIdentityTool.execute({ imageUrls: ['https://cdn.example.com/viggo.jpg'] }, { executeDescription: async () => ({}) as never })).rejects.toThrow('authorized team');
  });

  test('pins execution to the Vertex vision model', async () => {
    const source = await Bun.file(new URL('./image-create-visual-identity.ts', import.meta.url)).text();
    expect(imageCreateVisualIdentityTool.name).toBe('image.create-visual-identity');
    expect(source).toContain("actionSlug: 'image'");
    expect(source).toContain("providers: ['image.primary']");
  });
});
