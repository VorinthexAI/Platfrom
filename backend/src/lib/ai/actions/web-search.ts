import type { ActionDefinition } from './types';
export const webSearchAction: ActionDefinition = { id: 'web-search', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 }] };
