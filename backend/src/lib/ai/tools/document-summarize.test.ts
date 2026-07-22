import { expect, test } from 'bun:test';
import { documentSummarizeToolDefinition } from './document-summarize';

test('document.summarize definition has a name and input schema', () => {
  expect(documentSummarizeToolDefinition.name).toBe('document.summarize');
  expect(documentSummarizeToolDefinition.inputSchema).toBeDefined();
});
