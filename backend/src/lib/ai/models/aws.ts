import type { ModelDefinition, ModelId } from './types';

export const AWS_MODELS = {
  /**
   * Placeholder registry entry: the route stays disabled until Bedrock
   * credentials with Nova model access are provisioned, so it can never be
   * selected or executed.
   */
  'aws.nova-pro': {
    id: 'aws.nova-pro',
    name: 'Amazon Nova Pro',
    actions: ['core.chat'],
    actionProfiles: {
      'core.chat': { quality: 0.75, speed: 0.7, costEfficiency: 0.8, reliability: 0.8 },
    },
    routes: [{ providerId: 'aws-bedrock', externalModelId: 'amazon.nova-pro-v1:0', enabled: false }],
    enabled: true,
  },
} satisfies Partial<Record<ModelId, ModelDefinition>>;
