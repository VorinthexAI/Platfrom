import type { ActionDefinition } from './types';
export const speakAction: ActionDefinition = { id: 'speak', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-2-sonic', priority: 100 }] };
