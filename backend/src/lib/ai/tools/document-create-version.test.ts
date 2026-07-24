import { expect, test } from 'bun:test';
import { documentCreateVersionToolDefinition } from './document-create-version';

test('document.create-version definition has a name and input schema', () => {
  expect(documentCreateVersionToolDefinition.name).toBe('document.create-version');
  expect(documentCreateVersionToolDefinition.inputSchema).toBeDefined();
});
