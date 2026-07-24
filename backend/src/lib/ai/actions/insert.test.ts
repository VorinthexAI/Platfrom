import { expect, test } from 'bun:test'; import { insertActionDefinition } from './insert'; test('defines insert', () => expect(insertActionDefinition.id).toBe('insert'));
