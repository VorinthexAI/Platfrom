import { expect, test } from 'bun:test';
import { folderUpdateToolDefinition } from './folder-update';

test('folder.update definition has a name and input schema', () => {
  expect(folderUpdateToolDefinition.name).toBe('folder.update');
  expect(folderUpdateToolDefinition.inputSchema).toBeDefined();
});
