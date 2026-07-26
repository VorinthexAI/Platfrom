import type { ActionDefinition } from './types';
export const webSearchAction: ActionDefinition = { id: 'web-search', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }, { provider: 'openai', model: 'openai.gpt-5.6-terra', priority: 90 }] };
