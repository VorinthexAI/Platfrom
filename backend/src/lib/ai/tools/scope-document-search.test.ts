import { expect, test } from 'bun:test';
import { scopeDocumentSearchToolDefinition } from './scope-document-search';

test('scope.document.search definition has a name and input schema', () => {
  expect(scopeDocumentSearchToolDefinition.name).toBe('scope.document.search');
  expect(scopeDocumentSearchToolDefinition.inputSchema).toBeDefined();
});
