import { expect, test } from 'bun:test';
import { folderRestoreToolDefinition } from './folder-restore';

test('folder.restore definition has a name and input schema', () => {
  expect(folderRestoreToolDefinition.name).toBe('folder.restore');
  expect(folderRestoreToolDefinition.inputSchema).toBeDefined();
});
