import type { ActionDefinition } from './types';
export const askAction: ActionDefinition = { id: 'ask', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-2-lite', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 }, { provider: 'aws-bedrock', model: 'amazon.nova-premier', priority: 80 }] };
