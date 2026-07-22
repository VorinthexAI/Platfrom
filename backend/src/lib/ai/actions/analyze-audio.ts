import type { ActionDefinition } from './types';
export const analyzeAudioAction: ActionDefinition = { id: 'analyze-audio', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-2-lite', priority: 90 }] };
