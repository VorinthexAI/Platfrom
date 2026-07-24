import { expect, test } from 'bun:test'; import { editVideoAction } from './edit-video'; test('defines edit-video', () => expect(editVideoAction.id).toBe('edit-video'));
