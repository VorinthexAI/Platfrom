import { expect, test } from 'bun:test';
import { folderCreateToolDefinition } from './folder-create';

test('folder.create definition has a name and input schema', () => {
  expect(folderCreateToolDefinition.name).toBe('folder.create');
  expect(folderCreateToolDefinition.inputSchema).toBeDefined();
});
