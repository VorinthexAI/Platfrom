import { expect, test } from 'bun:test';
import { documentParseToolDefinition } from './document-parse';

test('document.parse definition has a name and input schema', () => {
  expect(documentParseToolDefinition.name).toBe('document.parse');
  expect(documentParseToolDefinition.inputSchema).toBeDefined();
});
