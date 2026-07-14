import type { ActionDefinition, ActionId } from './types';

export const WEB_ACTIONS = {
  'web.search': {
    id: 'web.search',
    name: 'Web Search',
    description: 'Search the live web and return grounded results for a query.',
    safeToRetry: true,
  },

  'web.deep-research': {
    id: 'web.deep-research',
    name: 'Deep Research',
    description: 'Multi-step web research across many sources, synthesized into a cited report.',
    safeToRetry: true,
  },
} satisfies Partial<Record<ActionId, ActionDefinition>>;
