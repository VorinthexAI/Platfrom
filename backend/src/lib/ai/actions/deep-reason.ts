import type { ActionDefinition } from './types';
export const deepReasonAction: ActionDefinition = { id: 'deep-reason', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-sol', priority: 100 }, { provider: 'openai', model: 'openai.gpt-5.6-terra', priority: 90 }] };
