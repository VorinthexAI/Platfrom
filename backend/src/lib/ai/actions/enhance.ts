import type { ActionDefinition } from './types';

export const enhanceAction: ActionDefinition = {
  id: 'enhance',
  modelPolicy: 'required',
  models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }],
};
