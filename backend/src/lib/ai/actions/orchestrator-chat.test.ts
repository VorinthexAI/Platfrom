import { expect, test } from 'bun:test';
import { orchestratorChatAction } from './orchestrator-chat';

test('binds orchestrator-chat only to Amazon Nova Lite', () => {
  expect(orchestratorChatAction).toEqual({
    id: 'orchestrator-chat',
    modelPolicy: 'required',
    models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }],
  });
});
