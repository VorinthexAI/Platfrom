import type { ActionDefinition } from './types';
export const reasonAction: ActionDefinition = { id: 'reason', modelPolicy: 'required', models: [{ provider: 'aws-bedrock', model: 'amazon.nova-pro', priority: 100 }, { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 90 }] };
