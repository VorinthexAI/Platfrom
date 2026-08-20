import { expect, test } from 'bun:test';
import { generateImageAction } from './generate-image';

test('keeps GPT Image 2 as the default image route and registers fast alternatives', () => {
  expect(generateImageAction).toEqual({
    id: 'generate-image',
    modelPolicy: 'configurable',
    models: [
      { provider: 'openai', model: 'openai.gpt-image-2', priority: 100 },
      { provider: 'openrouter', model: 'bfl.flux-2-klein-4b', priority: 90 },
      { provider: 'openrouter', model: 'xai.grok-imagine-image-quality', priority: 80 },
    ],
  });
});
