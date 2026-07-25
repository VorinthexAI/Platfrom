import type { ActionDefinition } from './types';
export const chatAction: ActionDefinition = { id: 'chat', modelPolicy: 'required', models: [{ provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-terra', priority: 100 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-luna', priority: 90 }, { provider: 'aws-bedrock-mantle', model: 'openai.gpt-5.6-sol', priority: 80 }] };
