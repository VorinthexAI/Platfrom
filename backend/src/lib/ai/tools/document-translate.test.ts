import { expect, test } from 'bun:test';
import { documentTranslateToolDefinition } from './document-translate';

test('document.translate definition has a name and input schema', () => {
  expect(documentTranslateToolDefinition.name).toBe('document.translate');
  expect(documentTranslateToolDefinition.inputSchema).toBeDefined();
});
