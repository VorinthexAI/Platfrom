import { expect, test } from 'bun:test';
import { documentListSharesToolDefinition } from './document-list-shares';

test('document.list-shares definition has a name and input schema', () => {
  expect(documentListSharesToolDefinition.name).toBe('document.list-shares');
  expect(documentListSharesToolDefinition.inputSchema).toBeDefined();
});
