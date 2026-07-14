import type { ModelDefinition, ModelId } from './types';

export const GOOGLE_MODELS = {
  'google.gemini-pro': {
    id: 'google.gemini-pro',
    name: 'Gemini Pro',
    actions: ['core.reason', 'core.ask'],
    actionProfiles: {
      'core.reason': { quality: 0.9, speed: 0.5, costEfficiency: 0.55, reliability: 0.85 },
      'core.ask': { quality: 0.88, speed: 0.55, costEfficiency: 0.6, reliability: 0.85 },
    },
    routes: [{ providerId: 'google-vertex', externalModelId: 'gemini-2.5-pro', enabled: true }],
    enabled: true,
  },

  'google.gemini-flash': {
    id: 'google.gemini-flash',
    name: 'Gemini Flash',
    actions: ['core.reason', 'core.ask'],
    actionProfiles: {
      'core.reason': { quality: 0.72, speed: 0.9, costEfficiency: 0.9, reliability: 0.85 },
      'core.ask': { quality: 0.75, speed: 0.92, costEfficiency: 0.92, reliability: 0.85 },
    },
    routes: [{ providerId: 'google-vertex', externalModelId: 'gemini-2.5-flash', enabled: true }],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
