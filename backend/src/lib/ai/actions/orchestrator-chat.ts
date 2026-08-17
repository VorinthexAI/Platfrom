import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = {
  id: 'orchestrator-chat',
  modelPolicy: 'required',
  models: [
    { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 },
    { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 },
  ],
};
