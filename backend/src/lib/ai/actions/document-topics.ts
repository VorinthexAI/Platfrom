import type { ActionDefinition } from './types';
export const documentTopicsAction: ActionDefinition = { id: 'document-topics', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }] };
