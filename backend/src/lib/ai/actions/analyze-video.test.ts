import { expect, test } from 'bun:test'; import { analyzeVideoAction } from './analyze-video'; test('defines analyze-video', () => expect(analyzeVideoAction.id).toBe('analyze-video'));
