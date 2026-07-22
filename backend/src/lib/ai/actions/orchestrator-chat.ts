import type { ActionDefinition } from './types';
export const orchestratorChatAction: ActionDefinition = { id: 'orchestrator-chat', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-2-sonic', priority: 100 }] };
