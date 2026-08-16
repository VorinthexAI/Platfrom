import type { ActionDefinition } from './types';
export const documentSummarizeAction: ActionDefinition = { id: 'document-summarize', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }] };
