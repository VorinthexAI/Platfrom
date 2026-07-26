import type { ActionDefinition } from './types';
export const chatAction: ActionDefinition = { id: 'chat', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 }, { provider: 'openai', model: 'openai.gpt-5.6-sol', priority: 80 }] };
