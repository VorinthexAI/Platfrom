import { expect, test } from 'bun:test'; import { chatAction } from './chat'; test('defines chat', () => expect(chatAction.id).toBe('chat'));
