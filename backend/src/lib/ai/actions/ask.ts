import type { ActionDefinition } from './types';
export const askAction: ActionDefinition = { id: 'ask', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
