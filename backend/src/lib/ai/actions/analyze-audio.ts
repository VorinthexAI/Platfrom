import type { ActionDefinition } from './types';
export const analyzeAudioAction: ActionDefinition = { id: 'analyze-audio', modelPolicy: 'required', models: [{ provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-luna', priority: 90 }] };
