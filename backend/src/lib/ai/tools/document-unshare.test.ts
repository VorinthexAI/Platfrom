import { expect, test } from 'bun:test';
import { documentUnshareToolDefinition } from './document-unshare';

test('document.unshare definition has a name and input schema', () => {
  expect(documentUnshareToolDefinition.name).toBe('document.unshare');
  expect(documentUnshareToolDefinition.inputSchema).toBeDefined();
});
