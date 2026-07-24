import type { ActionDefinition } from './types';
export const deepReasonAction: ActionDefinition = { id: 'deep-reason', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-premier', priority: 100 }, { provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 90 }] };
