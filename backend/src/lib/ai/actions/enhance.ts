import type { ActionDefinition } from './types';

export const enhanceAction: ActionDefinition = {
  id: 'enhance',
  modelPolicy: 'required',
  models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }],
};
