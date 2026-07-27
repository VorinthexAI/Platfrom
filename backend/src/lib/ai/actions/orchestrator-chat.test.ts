import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat only to OpenAI GPT Realtime 2', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [{ provider: 'openai', model: 'openai.gpt-realtime-2', priority: 80 }],
  });
});
