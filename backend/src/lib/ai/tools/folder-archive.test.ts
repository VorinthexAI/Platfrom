import { expect, test } from 'bun:test';
import { folderArchiveToolDefinition } from './folder-archive';

test('folder.archive definition has a name and input schema', () => {
  expect(folderArchiveToolDefinition.name).toBe('folder.archive');
  expect(folderArchiveToolDefinition.inputSchema).toBeDefined();
});
