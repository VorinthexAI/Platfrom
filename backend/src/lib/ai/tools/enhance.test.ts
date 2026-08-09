import { expect, test } from 'bun:test';
import { enhanceToolDefinition } from './enhance';

test('enhance definition has a strict input schema', () => {
  expect(enhanceToolDefinition.name).toBe('enhance');
  expect(enhanceToolDefinition.providerDefinition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
});
