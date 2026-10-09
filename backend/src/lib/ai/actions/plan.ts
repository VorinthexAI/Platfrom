import type { ActionDefinition } from './types';

export const planAction: ActionDefinition = {
  id: 'plan',
  modelPolicy: 'required',
  models: [
    { slot: 'primary', provider: 'openrouter', model: 'google.gemini-3.8-flash', priority: 100 },
  ],
};
