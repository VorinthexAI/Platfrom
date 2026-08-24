import type { ActionDefinition } from './types';
export const generateImageAction: ActionDefinition = { id: 'generate-image', modelPolicy: 'configurable', models: [
  { provider: 'openrouter', model: 'bfl.flux-2-klein-4b', priority: 100 },
  { provider: 'openai', model: 'openai.gpt-image-2', priority: 90 },
  { provider: 'openrouter', model: 'xai.grok-imagine-image-quality', priority: 80 },
] };
