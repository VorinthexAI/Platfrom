import type { ActionDefinition } from './types';
export const askAction: ActionDefinition = {
  id: 'ask',
  modelPolicy: 'required',
  models: [
    { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 },
    { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 },
  ],
};
