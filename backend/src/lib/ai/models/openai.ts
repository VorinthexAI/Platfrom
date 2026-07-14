import type { ModelDefinition, ModelId } from './types';

export const OPENAI_MODELS = {
  'openai.gpt-5.4-mini': {
    id: 'openai.gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    actions: ['core.reason'],
    actionProfiles: {
      'core.reason': { quality: 0.9, speed: 0.75, costEfficiency: 0.75, reliability: 0.9 },
    },
    routes: [{ providerId: 'openai', externalModelId: 'gpt-5.4-mini', enabled: true }],
    enabled: true,
  },

  'openai.gpt-5.4-nano': {
    id: 'openai.gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    actions: ['core.ask'],
    actionProfiles: {
      'core.ask': { quality: 0.75, speed: 0.95, costEfficiency: 0.95, reliability: 0.9 },
    },
    routes: [{ providerId: 'openai', externalModelId: 'gpt-5.4-nano', enabled: true }],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
