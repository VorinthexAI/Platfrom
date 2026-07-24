import { expect, test } from 'bun:test';
import { documentFindVersionToolDefinition } from './document-find-version';

test('document.find-version definition has a name and input schema', () => {
  expect(documentFindVersionToolDefinition.name).toBe('document.find-version');
  expect(documentFindVersionToolDefinition.inputSchema).toBeDefined();
});
