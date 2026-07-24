import { expect, test } from 'bun:test'; import { askAction } from './ask'; test('defines ask', () => expect(askAction.id).toBe('ask'));
