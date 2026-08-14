import { expect, test } from 'bun:test';
import { folderCopyToolDefinition } from './folder-copy';

test('folder.copy definition has a name and input schema', () => {
  expect(folderCopyToolDefinition.name).toBe('folder.copy');
  expect(folderCopyToolDefinition.inputSchema).toBeDefined();
});
