import { expect, test } from 'bun:test';
import { chatAction } from './chat';
import { coreChatInputSchema } from './core-chat';

test('defines one chat action with default and deep model bindings', () => {
  expect(chatAction.models).toEqual([
    { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 },
    { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 },
  ]);
  const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
  expect(coreChatInputSchema.parse(input).mode).toBe('default');
  expect(coreChatInputSchema.parse({ ...input, mode: 'deep' }).mode).toBe('deep');
  expect(coreChatInputSchema.safeParse({ ...input, mode: 'other' }).success).toBe(false);
});
