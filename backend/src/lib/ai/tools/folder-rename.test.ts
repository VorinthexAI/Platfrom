import { expect, test } from 'bun:test';
import { folderRenameToolDefinition } from './folder-rename';

test('folder.rename definition has a name and input schema', () => {
  expect(folderRenameToolDefinition.name).toBe('folder.rename');
  expect(folderRenameToolDefinition.inputSchema).toBeDefined();
});
