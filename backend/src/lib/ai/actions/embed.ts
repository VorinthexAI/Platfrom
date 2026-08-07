import type { ActionDefinition } from './types';
export const embedAction: ActionDefinition = { id: 'embed', modelPolicy: 'required', models: [{ provider: 'openrouter', model: 'qwen.qwen3-embedding-8b', priority: 100 }] };
