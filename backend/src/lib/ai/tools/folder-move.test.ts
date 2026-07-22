import { expect, test } from 'bun:test';
import { folderMoveToolDefinition } from './folder-move';

test('folder.move definition has a name and input schema', () => {
  expect(folderMoveToolDefinition.name).toBe('folder.move');
  expect(folderMoveToolDefinition.inputSchema).toBeDefined();
});
