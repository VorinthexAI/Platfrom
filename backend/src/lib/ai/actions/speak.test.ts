import { expect, test } from 'bun:test'; import { speakAction } from './speak'; test('defines speak', () => expect(speakAction.id).toBe('speak'));
