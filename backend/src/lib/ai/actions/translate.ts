import type { ActionDefinition } from './types';

export const translateAction: ActionDefinition = {
  id: 'translate',
  modelPolicy: 'required',
  models: [{ provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 }],
};
