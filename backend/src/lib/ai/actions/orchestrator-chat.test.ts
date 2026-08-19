import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat to direct OpenAI Luna', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }],
  });
});
