import { expect, test } from 'bun:test';
import { documentReadToolDefinition } from './document-read';

test('document.read definition has a name and input schema', () => {
  expect(documentReadToolDefinition.name).toBe('document.read');
  expect(documentReadToolDefinition.inputSchema).toBeDefined();
});
