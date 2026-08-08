import { expect, test } from 'bun:test';
import { folderContentToolDefinition } from './folder-content';

test('folder.archive definition has a name and input schema', () => {
  expect(folderContentToolDefinition.name).toBe('folder.archive');
  expect(folderContentToolDefinition.inputSchema).toBeDefined();
});
