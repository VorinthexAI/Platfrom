import { expect, test } from 'bun:test';
import { documentRewriteToolDefinition } from './document-rewrite';

test('document.rewrite definition has a name and input schema', () => {
  expect(documentRewriteToolDefinition.name).toBe('document.rewrite');
  expect(documentRewriteToolDefinition.inputSchema).toBeDefined();
});
