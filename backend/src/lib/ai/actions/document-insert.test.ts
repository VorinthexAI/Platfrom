import { expect, test } from 'bun:test'; import { documentInsertAction } from './document-insert'; test('defines document-insert', () => expect(documentInsertAction.id).toBe('document-insert'));
