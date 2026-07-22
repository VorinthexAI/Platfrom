import { expect, test } from 'bun:test'; import { generateSpeechAction } from './generate-speech'; test('defines generate-speech', () => expect(generateSpeechAction.id).toBe('generate-speech'));
