import type { ActionDefinition } from './types';
export const speakAction: ActionDefinition = { id: 'speak', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-realtime-2', priority: 100 }] };
