import { expect, test } from 'bun:test';
import { transcribeAction } from './transcribe';

test('binds transcribe only to OpenAI GPT Realtime 2', () => {
  expect(transcribeAction).toEqual({
    id: 'transcribe',
    modelPolicy: 'required',
    models: [{ provider: 'openai', model: 'openai.gpt-realtime-2', priority: 100 }],
  });
});
