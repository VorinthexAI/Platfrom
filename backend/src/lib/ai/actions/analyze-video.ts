import type { ActionDefinition } from './types';
export const analyzeVideoAction: ActionDefinition = { id: 'analyze-video', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-2-lite', priority: 90 }, { provider: 'aws-bedrock', model: 'amazon.nova-premier', priority: 80 }] };
