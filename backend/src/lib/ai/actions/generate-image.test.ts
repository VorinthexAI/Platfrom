import { expect, test } from 'bun:test'; import { generateImageAction } from './generate-image'; test('defines generate-image', () => expect(generateImageAction.id).toBe('generate-image'));
