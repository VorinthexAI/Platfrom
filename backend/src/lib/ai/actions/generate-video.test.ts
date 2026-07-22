import { expect, test } from 'bun:test'; import { generateVideoAction } from './generate-video'; test('defines generate-video', () => expect(generateVideoAction.id).toBe('generate-video'));
