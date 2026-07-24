import { expect, test } from 'bun:test';
import { documentListVersionsToolDefinition } from './document-list-versions';

test('document.list-versions definition has a name and input schema', () => {
  expect(documentListVersionsToolDefinition.name).toBe('document.list-versions');
  expect(documentListVersionsToolDefinition.inputSchema).toBeDefined();
});
