import { expect, test } from 'bun:test';
import { documentRestoreToolDefinition } from './document-restore';

test('document.restore definition has a name and input schema', () => {
  expect(documentRestoreToolDefinition.name).toBe('document.restore');
  expect(documentRestoreToolDefinition.inputSchema).toBeDefined();
});
