import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = {
  id: 'orchestrator-chat',
  modelPolicy: 'required',
  models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }],
};
