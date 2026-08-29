import { expect, test } from 'bun:test';
import { askAction } from './ask';
import { coreChatInputSchema } from './core-chat';

test('defines one ask action with default and deep model bindings', () => {
  expect(askAction.models).toEqual([{ provider: 'google-vertex', model: 'google.gemini-3.5-flash-lite', priority: 100 }]);
  const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
  expect(coreChatInputSchema.parse(input).mode).toBe('default');
  expect(coreChatInputSchema.parse({ ...input, mode: 'deep' }).mode).toBe('deep');
  expect(coreChatInputSchema.safeParse({ ...input, mode: 'other' }).success).toBe(false);
});
