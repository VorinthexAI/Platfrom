import { expect, test } from 'bun:test';
import { documentSearchToolDefinition } from './document-search';

test('document.search definition has a name and input schema', () => {
  expect(documentSearchToolDefinition.name).toBe('document.search');
  expect(documentSearchToolDefinition.inputSchema).toBeDefined();
});
