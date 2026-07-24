import { expect, test } from 'bun:test';
import { documentArchiveToolDefinition } from './document-archive';

test('document.archive definition has a name and input schema', () => {
  expect(documentArchiveToolDefinition.name).toBe('document.archive');
  expect(documentArchiveToolDefinition.inputSchema).toBeDefined();
});
