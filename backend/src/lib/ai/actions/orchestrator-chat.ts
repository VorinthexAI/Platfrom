import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = { id: 'orchestrator-chat', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-realtime-2', priority: 80 }] };
