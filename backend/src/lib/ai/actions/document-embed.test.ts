import { expect, test } from 'bun:test'; import { documentEmbedAction } from './document-embed'; test('defines document-embed', () => expect(documentEmbedAction.id).toBe('document-embed'));
