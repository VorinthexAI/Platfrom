import { expect, test } from 'bun:test';
import { documentListToolDefinition } from './document-list';

test('document.list definition has a name and input schema', () => {
  expect(documentListToolDefinition.name).toBe('document.list');
  expect(documentListToolDefinition.inputSchema).toBeDefined();
});
