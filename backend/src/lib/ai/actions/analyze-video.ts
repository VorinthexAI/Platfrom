import type { ActionDefinition } from './types';
export const analyzeVideoAction: ActionDefinition = { id: 'analyze-video', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
