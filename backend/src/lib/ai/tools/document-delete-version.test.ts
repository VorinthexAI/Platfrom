import { expect, test } from 'bun:test';
import { documentDeleteVersionToolDefinition } from './document-delete-version';

test('document.delete-version definition has a name and input schema', () => {
  expect(documentDeleteVersionToolDefinition.name).toBe('document.delete-version');
  expect(documentDeleteVersionToolDefinition.inputSchema).toBeDefined();
});
