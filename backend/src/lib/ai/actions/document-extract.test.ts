import { expect, test } from 'bun:test'; import { documentExtractAction } from './document-extract'; test('defines document-extract', () => expect(documentExtractAction.id).toBe('document-extract'));
