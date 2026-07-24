import { expect, test } from 'bun:test'; import { transcribeAction } from './transcribe'; test('defines transcribe', () => expect(transcribeAction.id).toBe('transcribe'));
