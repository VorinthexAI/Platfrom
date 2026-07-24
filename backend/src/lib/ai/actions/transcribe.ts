import type { ActionDefinition } from './types';
export const transcribeAction: ActionDefinition = { id: 'transcribe', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-2-sonic', priority: 100 }] };
