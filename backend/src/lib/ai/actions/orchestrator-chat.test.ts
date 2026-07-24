import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat to Bedrock text models', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [
      { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 },
      { provider: 'aws-bedrock', model: 'amazon.nova-2-lite', priority: 90 },
    ],
  });
});
