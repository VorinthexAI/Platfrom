import type { ActionDefinition } from './types';
export const analyzeVideoAction: ActionDefinition = { id: 'analyze-video', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 90 }] };
