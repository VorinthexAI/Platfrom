import type { ActionDefinition } from './types';
export const askAction: ActionDefinition = { id: 'ask', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 }] };
