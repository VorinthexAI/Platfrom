import type { ActionDefinition, ActionId } from './types';

export const CORE_ACTIONS = {
  'core.reason': {
    id: 'core.reason',
    name: 'Reason',
    description: 'Multi-step reasoning over a prompt: planning, analysis, and structured problem solving.',
    safeToRetry: true,
  },

  'core.chat': {
    id: 'core.chat',
    name: 'Chat',
    description: 'Conversational text generation over a message history.',
    safeToRetry: true,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
