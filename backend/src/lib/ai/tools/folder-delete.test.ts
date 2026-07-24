import { expect, test } from 'bun:test';
import { folderDeleteToolDefinition } from './folder-delete';

test('folder.delete definition has a name and input schema', () => {
  expect(folderDeleteToolDefinition.name).toBe('folder.delete');
  expect(folderDeleteToolDefinition.inputSchema).toBeDefined();
});
