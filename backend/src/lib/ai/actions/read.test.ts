import { expect, test } from 'bun:test'; import { readAction } from './read'; test('defines read', () => expect(readAction.id).toBe('read'));
