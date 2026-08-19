import { expect, test } from 'bun:test';
import { documentSearchAllToolDefinition } from './document-search-all';

test('document.search-all definition has a name and input schema', () => {
  expect(documentSearchAllToolDefinition.name).toBe('document.search-all');
  expect(documentSearchAllToolDefinition.inputSchema).toBeDefined();
});
