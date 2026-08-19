import { expect, test } from 'bun:test';
import { generateImageAction } from './generate-image';

test('binds generate-image to GPT Image 2 through OpenRouter', () => {
  expect(generateImageAction).toEqual({
    id: 'generate-image',
    modelPolicy: 'configurable',
    models: [{ provider: 'openrouter', model: 'openai.gpt-image-2', priority: 100 }],
  });
});
