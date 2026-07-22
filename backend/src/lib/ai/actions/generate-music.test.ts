import { expect, test } from 'bun:test'; import { generateMusicAction } from './generate-music'; test('defines generate-music', () => expect(generateMusicAction.id).toBe('generate-music'));
