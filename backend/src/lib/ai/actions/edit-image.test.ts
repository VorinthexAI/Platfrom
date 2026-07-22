import { expect, test } from 'bun:test'; import { editImageAction } from './edit-image'; test('defines edit-image', () => expect(editImageAction.id).toBe('edit-image'));
