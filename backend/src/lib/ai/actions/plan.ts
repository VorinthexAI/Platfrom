import type { ActionDefinition } from './types';

export const planAction: ActionDefinition = {
  id: 'plan',
  modelPolicy: 'required',
  models: [
    { slot: 'primary', provider: 'openrouter', model: 'anthropic.claude-sonnet-4.5', priority: 100 },
  ],
};
