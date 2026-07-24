import { expect, test } from 'bun:test';
import { documentDeleteToolDefinition } from './document-delete';

test('document.delete definition has a name and input schema', () => {
  expect(documentDeleteToolDefinition.name).toBe('document.delete');
  expect(documentDeleteToolDefinition.inputSchema).toBeDefined();
});
