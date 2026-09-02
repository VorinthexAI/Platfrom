import type { ActionDefinition } from './types';

export const textAction: ActionDefinition = {
  id: 'text',
  modelPolicy: 'required',
  models: [
    { slot: 'primary', provider: 'openrouter', model: 'google.gemini-3.1-flash-lite', priority: 100 },
  ],
};
