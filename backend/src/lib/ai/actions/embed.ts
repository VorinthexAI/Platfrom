import type { ActionDefinition } from './types';
export const embedAction: ActionDefinition = { id: 'embed', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.text-embedding-3-small', priority: 100 }] };
