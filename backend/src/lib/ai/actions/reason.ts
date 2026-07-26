import type { ActionDefinition } from './types';
export const reasonAction: ActionDefinition = { id: 'reason', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 90 }] };
