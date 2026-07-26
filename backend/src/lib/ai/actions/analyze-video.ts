import type { ActionDefinition } from './types';
export const analyzeVideoAction: ActionDefinition = { id: 'analyze-video', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 90 }] };
