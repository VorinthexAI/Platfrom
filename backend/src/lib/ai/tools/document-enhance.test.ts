import { expect, test } from 'bun:test';
import { documentEnhanceToolDefinition } from './document-enhance';

test('document.enhance definition has a name and input schema', () => {
  expect(documentEnhanceToolDefinition.name).toBe('document.enhance');
  expect(documentEnhanceToolDefinition.providerDefinition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
});
