import { expect, test } from 'bun:test';
import { documentRenameToolDefinition } from './document-rename';

test('document.rename definition has a name and input schema', () => {
  expect(documentRenameToolDefinition.name).toBe('document.rename');
  expect(documentRenameToolDefinition.inputSchema).toBeDefined();
});
