import { expect, test } from 'bun:test'; import { extendVideoAction } from './extend-video'; test('defines extend-video', () => expect(extendVideoAction.id).toBe('extend-video'));
