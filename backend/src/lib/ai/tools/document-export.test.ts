import { expect, test } from 'bun:test';
import { documentExportToolDefinition } from './document-export';

test('document.export definition has a name and input schema', () => {
  expect(documentExportToolDefinition.name).toBe('document.export');
  expect(documentExportToolDefinition.inputSchema).toBeDefined();
});
