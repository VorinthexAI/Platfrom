import type { ActionDefinition } from './types';
export const reasonAction: ActionDefinition = { id: 'reason', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
