import { expect, test } from 'bun:test'; import { analyzeAudioAction } from './analyze-audio'; test('defines analyze-audio', () => expect(analyzeAudioAction.id).toBe('analyze-audio'));
