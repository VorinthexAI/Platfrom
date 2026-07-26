import type { ActionDefinition } from './types';
export const transcribeAction: ActionDefinition = { id: 'transcribe', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-realtime-2', priority: 100 }] };
