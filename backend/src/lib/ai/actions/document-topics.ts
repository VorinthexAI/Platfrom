import type { ActionDefinition } from './types';
export const documentTopicsAction: ActionDefinition = { id: 'document-topics', modelPolicy: 'required', models: [{ provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 }] };
