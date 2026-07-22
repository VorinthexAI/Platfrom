import { expect, test } from 'bun:test';
import { documentDownloadToolDefinition } from './document-download';

test('document.download definition has a name and input schema', () => {
  expect(documentDownloadToolDefinition.name).toBe('document.download');
  expect(documentDownloadToolDefinition.inputSchema).toBeDefined();
});
