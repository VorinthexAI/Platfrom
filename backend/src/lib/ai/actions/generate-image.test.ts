import { expect, test } from 'bun:test';
import { generateImageAction } from './generate-image';

test('keeps Flux Klein as the fast default image route and registers quality alternatives', () => {
  expect(generateImageAction).toEqual({
    id: 'generate-image',
    modelPolicy: 'configurable',
    models: [{ provider: 'google-vertex', model: 'google.gemini-3.1-flash-lite-image', priority: 100 }],
  });
});
