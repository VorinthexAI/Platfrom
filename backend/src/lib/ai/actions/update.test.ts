import { expect, test } from 'bun:test'; import { updateActionDefinition } from './update'; test('defines update', () => expect(updateActionDefinition.id).toBe('update'));
