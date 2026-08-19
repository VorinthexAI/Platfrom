import type { ActionDefinition } from './types';
export const documentTopicsAction: ActionDefinition = { id: 'document-topics', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
