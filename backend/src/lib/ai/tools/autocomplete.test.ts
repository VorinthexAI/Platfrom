import { expect, test } from 'bun:test';
import { autocompleteToolDefinition } from './autocomplete';

test('autocomplete definition has a strict input schema', () => {
  expect(autocompleteToolDefinition.name).toBe('autocomplete');
  expect(autocompleteToolDefinition.providerDefinition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
});
