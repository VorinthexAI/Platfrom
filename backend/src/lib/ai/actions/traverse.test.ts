import { expect, test } from 'bun:test'; import { traverseAction } from './traverse'; test('defines traverse', () => expect(traverseAction.id).toBe('traverse'));
