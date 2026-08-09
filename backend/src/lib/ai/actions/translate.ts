import type { ActionDefinition } from './types';

export const translateAction: ActionDefinition = {
  id: 'translate',
  modelPolicy: 'required',
  models: [{ provider: 'aws-bedrock', model: 'amazon.nova-lite', priority: 100 }],
};
