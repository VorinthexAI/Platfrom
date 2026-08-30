import type { ActionDefinition } from './types';

export const imageAction: ActionDefinition = {
  id: 'image',
  modelPolicy: 'required',
  models: [
    { slot: 'primary', provider: 'openrouter', model: 'google.gemini-3.1-flash-lite-image', priority: 100 },
  ],
};
