import type { ActionDefinition, ActionId } from './types';

export const CORE_ACTIONS = {
  // Agents don't chat — agents answer. An agent without core.ask simply
  // has no conversational surface at all.
  'core.ask': {
    id: 'core.ask',
    name: 'Ask',
    description: 'Answer a question or request over the current message history.',
    safeToRetry: true,
  },

  'core.reason': {
    id: 'core.reason',
    name: 'Reason',
    description: 'Multi-step reasoning over a prompt: planning, analysis, and structured problem solving.',
    safeToRetry: true,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
