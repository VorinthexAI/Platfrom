import type { ActionDefinition } from './types';
export const generateImageAction: ActionDefinition = {
  id: 'generate-image',
  modelPolicy: 'configurable',
  models: [{ provider: 'openrouter', model: 'openai.gpt-image-2', priority: 100 }],
};
