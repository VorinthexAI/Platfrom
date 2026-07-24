import { expect, test } from 'bun:test';
import { documentMoveToolDefinition } from './document-move';

test('document.move definition has a name and input schema', () => {
  expect(documentMoveToolDefinition.name).toBe('document.move');
  expect(documentMoveToolDefinition.inputSchema).toBeDefined();
});
