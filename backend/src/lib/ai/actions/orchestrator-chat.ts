import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = { id: 'orchestrator-chat', modelPolicy: 'required', models: [{ provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-luna', priority: 90 }] };
