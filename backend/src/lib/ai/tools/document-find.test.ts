import { expect, test } from 'bun:test';
import { documentFindToolDefinition } from './document-find';

test('document.find definition has a name and input schema', () => {
  expect(documentFindToolDefinition.name).toBe('document.find');
  expect(documentFindToolDefinition.inputSchema).toBeDefined();
});
