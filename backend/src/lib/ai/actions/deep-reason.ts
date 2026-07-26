import type { ActionDefinition } from './types';
export const deepReasonAction: ActionDefinition = { id: 'deep-reason', modelPolicy: 'required', models: [{ provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-sol', priority: 100 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 90 }] };
