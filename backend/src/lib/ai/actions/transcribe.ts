import type { ActionDefinition } from './types';
export const transcribeAction: ActionDefinition = { id: 'transcribe', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-4o-mini-transcribe', priority: 100 }] };
