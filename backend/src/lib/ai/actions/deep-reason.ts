import type { ActionDefinition } from './types';
// Nova Premier is the intended Sol replacement, but AWS currently blocks it as legacy for this account.
export const deepReasonAction: ActionDefinition = { id: 'deep-reason', modelPolicy: 'required', models: [{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }] };
