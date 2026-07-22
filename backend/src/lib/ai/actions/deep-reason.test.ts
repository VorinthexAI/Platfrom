import { expect, test } from 'bun:test'; import { deepReasonAction } from './deep-reason'; test('defines deep-reason', () => expect(deepReasonAction.id).toBe('deep-reason'));
