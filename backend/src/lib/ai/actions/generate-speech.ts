import type { ActionDefinition } from './types';
export const generateSpeechAction: ActionDefinition = { id: 'generate-speech', modelPolicy: 'required', models: [{ provider: 'aws-polly', model: 'amazon.polly-generative', priority: 100 }] };
