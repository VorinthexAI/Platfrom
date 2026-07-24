import { expect, test } from 'bun:test';
import { organizationDocumentSearchToolDefinition } from './organization-document-search';

test('organization.document.search definition has a name and input schema', () => {
  expect(organizationDocumentSearchToolDefinition.name).toBe('organization.document.search');
  expect(organizationDocumentSearchToolDefinition.inputSchema).toBeDefined();
});
