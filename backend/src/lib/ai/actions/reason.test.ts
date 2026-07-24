import { expect, test } from 'bun:test'; import { reasonAction } from './reason'; test('defines reason', () => expect(reasonAction.id).toBe('reason'));
