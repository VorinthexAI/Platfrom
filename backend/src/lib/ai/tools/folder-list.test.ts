import { expect, test } from 'bun:test';
import { folderListToolDefinition } from './folder-list';

test('folder.list definition has a name and input schema', () => {
  expect(folderListToolDefinition.name).toBe('folder.list');
  expect(folderListToolDefinition.inputSchema).toBeDefined();
});
