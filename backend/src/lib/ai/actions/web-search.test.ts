import { expect, test } from 'bun:test';
import { webSearchAction, webSearchInputSchema, webSearchOutputSchema } from './web-search';

test('defines mode-routed web search with strict grounded-text contracts', () => {
  expect(webSearchAction.models).toEqual([{ provider: 'google-vertex', model: 'google.gemini-3.7-flash', priority: 100 }]);
  expect(webSearchInputSchema.parse({ prompt: 'Research Japan' })).toEqual({ mode: 'default', prompt: 'Research Japan' });
  expect(webSearchInputSchema.parse({ prompt: 'Research Japan', responseFormat: { name: 'place_detail', schema: { type: 'object' } } })).toMatchObject({ responseFormat: { name: 'place_detail' } });
  expect(webSearchInputSchema.safeParse({ prompt: 'Research Japan', unknown: true }).success).toBe(false);
  expect(webSearchInputSchema.safeParse({ prompt: 'Research Japan', imageCount: 4 }).success).toBe(false);
  expect(webSearchOutputSchema.safeParse({ text: 'Japan', citations: [], sources: [], images: [] }).success).toBe(false);
});
