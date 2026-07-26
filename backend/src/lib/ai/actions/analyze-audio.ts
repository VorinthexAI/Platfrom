import type { ActionDefinition } from './types';
export const analyzeAudioAction: ActionDefinition = { id: 'analyze-audio', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 90 }] };
