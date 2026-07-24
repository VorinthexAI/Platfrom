import type { ActionDefinition } from './types';
export const webSearchAction: ActionDefinition = { id: 'web-search', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-2-lite', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 }] };
