import type { ActionDefinition } from './types';
export const analyzeAudioAction: ActionDefinition = { id: 'analyze-audio', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 }] };
