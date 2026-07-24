import { expect, test } from 'bun:test';
import { documentUpdateToolDefinition } from './document-update';

test('document.update definition has a name and input schema', () => {
  expect(documentUpdateToolDefinition.name).toBe('document.update');
  expect(documentUpdateToolDefinition.inputSchema).toBeDefined();
});
