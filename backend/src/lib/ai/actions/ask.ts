import type { ActionDefinition } from './types';
export const askAction: ActionDefinition = {
  id: 'ask',
  modelPolicy: 'required',
  models: [{ provider: 'google-vertex', model: 'google.gemini-3.5-flash-lite', priority: 100 }],
};
