import type { ActionDefinition } from './types';

export const translateAction: ActionDefinition = {
  id: 'translate',
  modelPolicy: 'required',
  models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }],
};
