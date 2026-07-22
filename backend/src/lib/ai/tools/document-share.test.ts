import { expect, test } from 'bun:test';
import { documentShareToolDefinition } from './document-share';

test('document.share definition has a name and input schema', () => {
  expect(documentShareToolDefinition.name).toBe('document.share');
  expect(documentShareToolDefinition.inputSchema).toBeDefined();
});
