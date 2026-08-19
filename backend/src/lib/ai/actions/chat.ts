import type { ActionDefinition } from './types';
export const chatAction: ActionDefinition = { id: 'chat', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
