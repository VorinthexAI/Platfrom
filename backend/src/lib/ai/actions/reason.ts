import type { ActionDefinition } from './types';
export const reasonAction: ActionDefinition = { id: 'reason', modelPolicy: 'required', models: [{ provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-sol', priority: 90 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-luna', priority: 80 }] };
