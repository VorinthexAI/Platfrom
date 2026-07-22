import { expect, test } from 'bun:test'; import { deleteActionDefinition } from './delete'; test('defines delete', () => expect(deleteActionDefinition.id).toBe('delete'));
