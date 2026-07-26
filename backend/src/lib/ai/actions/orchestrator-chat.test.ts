import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat to Bedrock text models', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [
      { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 100 },
      { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-luna', priority: 90 },
    ],
  });
});
