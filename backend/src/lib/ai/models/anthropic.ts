import type { ModelDefinition, ModelId } from './types';

export const ANTHROPIC_MODELS = {
  'anthropic.claude-sonnet': {
    id: 'anthropic.claude-sonnet',
    name: 'Claude Sonnet',
    actions: ['core.reason', 'core.chat'],
    actionProfiles: {
      'core.reason': { quality: 0.95, speed: 0.5, costEfficiency: 0.45, reliability: 0.95 },
      'core.chat': { quality: 0.92, speed: 0.6, costEfficiency: 0.5, reliability: 0.95 },
    },
    routes: [
      { providerId: 'anthropic', externalModelId: 'claude-sonnet-4-5', enabled: true },
      // Bedrock inference profile — enable once Bedrock credentials with
      // model access are provisioned (AWS_BEDROCK_REGION opt-in).
      { providerId: 'aws-bedrock', externalModelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', enabled: false },
      { providerId: 'openrouter', externalModelId: 'anthropic/claude-sonnet-4.5', enabled: true },
    ],
    enabled: true,
  },

  'anthropic.claude-haiku': {
    id: 'anthropic.claude-haiku',
    name: 'Claude Haiku',
    actions: ['core.reason', 'core.chat'],
    actionProfiles: {
      'core.reason': { quality: 0.7, speed: 0.9, costEfficiency: 0.9, reliability: 0.95 },
      'core.chat': { quality: 0.75, speed: 0.92, costEfficiency: 0.92, reliability: 0.95 },
    },
    routes: [
      { providerId: 'anthropic', externalModelId: 'claude-haiku-4-5', enabled: true },
      { providerId: 'openrouter', externalModelId: 'anthropic/claude-haiku-4.5', enabled: true },
    ],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
