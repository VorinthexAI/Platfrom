import { expect, test } from 'bun:test';
import { webSearchAction, webSearchInputSchema, webSearchOutputSchema } from './web-search';

test('defines Luna web search with strict text and image contracts', () => {
  expect(webSearchAction).toEqual({ id: 'web-search', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] });
  expect(webSearchInputSchema.parse({ prompt: 'Research Japan', imageCount: 4 })).toEqual({ prompt: 'Research Japan', imageCount: 4 });
  expect(webSearchInputSchema.parse({ prompt: 'Research Japan', responseFormat: { name: 'place_detail', schema: { type: 'object' } } })).toMatchObject({ responseFormat: { name: 'place_detail' } });
  expect(webSearchInputSchema.safeParse({ prompt: 'Research Japan', unknown: true }).success).toBe(false);
  expect(webSearchOutputSchema.safeParse({ text: 'Japan', citations: [], sources: [], images: [{ imageUrl: 'http://unsafe.example/image.jpg', sourcePageUrl: 'https://example.com' }] }).success).toBe(false);
});
