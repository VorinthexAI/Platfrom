import type { ActionDefinition } from './types';
export const generateImageAction: ActionDefinition = { id: 'generate-image', modelPolicy: 'configurable', models: [
  { provider: 'google-vertex', model: 'google.gemini-3.1-flash-lite-image', priority: 100 },
] };
