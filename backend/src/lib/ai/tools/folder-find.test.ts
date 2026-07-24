import { expect, test } from 'bun:test';
import { folderFindToolDefinition } from './folder-find';

test('folder.find definition has a name and input schema', () => {
  expect(folderFindToolDefinition.name).toBe('folder.find');
  expect(folderFindToolDefinition.inputSchema).toBeDefined();
});
