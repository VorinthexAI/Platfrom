import type { ActionDefinition } from './types';
export const documentSummarizeAction: ActionDefinition = { id: 'document-summarize', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
