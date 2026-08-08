import { expect, test } from 'bun:test';
import { documentContentToolDefinition } from './document-content';

test('document.archive definition has a name and input schema', () => {
  expect(documentContentToolDefinition.name).toBe('document.archive');
  expect(documentContentToolDefinition.inputSchema).toBeDefined();
});
