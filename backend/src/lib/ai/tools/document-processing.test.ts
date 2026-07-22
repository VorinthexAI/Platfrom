import { expect, test } from 'bun:test';
import { documentProcessingToolDefinition } from './document-processing';

test('document.processing definition has a name and input schema', () => {
  expect(documentProcessingToolDefinition.name).toBe('document.processing');
  expect(documentProcessingToolDefinition.inputSchema).toBeDefined();
});
