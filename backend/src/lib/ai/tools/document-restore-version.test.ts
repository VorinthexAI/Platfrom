import { expect, test } from 'bun:test';
import { documentRestoreVersionToolDefinition } from './document-restore-version';

test('document.restore-version definition has a name and input schema', () => {
  expect(documentRestoreVersionToolDefinition.name).toBe('document.restore-version');
  expect(documentRestoreVersionToolDefinition.inputSchema).toBeDefined();
});
