import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat to Amazon Nova Lite with Nova Pro fallback', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [
      { provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 },
      { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 },
    ],
  });
});
