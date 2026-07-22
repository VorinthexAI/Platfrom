import { expect, test } from 'bun:test';
import { documentCopyToolDefinition } from './document-copy';

test('document.copy definition has a name and input schema', () => {
  expect(documentCopyToolDefinition.name).toBe('document.copy');
  expect(documentCopyToolDefinition.inputSchema).toBeDefined();
});
