import type { ModelDefinition, ModelId } from './types';

export const XAI_MODELS = {
  'xai.grok': {
    id: 'xai.grok',
    name: 'Grok',
    actions: ['core.reason', 'core.ask'],
    actionProfiles: {
      'core.reason': { quality: 0.85, speed: 0.55, costEfficiency: 0.5, reliability: 0.8 },
      'core.ask': { quality: 0.82, speed: 0.6, costEfficiency: 0.55, reliability: 0.8 },
    },
    routes: [
      { providerId: 'xai', externalModelId: 'grok-4', enabled: true },
      { providerId: 'openrouter', externalModelId: 'x-ai/grok-4', enabled: true },
    ],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
