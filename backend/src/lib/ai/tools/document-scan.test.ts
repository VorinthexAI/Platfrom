import { expect, test } from 'bun:test';
import { documentScanToolDefinition } from './document-scan';

test('document.scan is registered as a strict public content tool', () => {
  expect(documentScanToolDefinition.name).toBe('document.scan');
  expect(() => documentScanToolDefinition.inputSchema.parse({ scopeKey: 'invalid', pages: [], unknown: true })).toThrow();
});
