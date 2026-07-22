import type { ActionDefinition } from './types';
export const embedAction: ActionDefinition = { id: 'embed', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.titan-embed-text-v2', priority: 100 }] };
