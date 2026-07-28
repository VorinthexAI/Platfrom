import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = { id: 'orchestrator-chat', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }] };
