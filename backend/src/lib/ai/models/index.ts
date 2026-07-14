import { PROVIDER_SLUGS } from '@/lib/ai/providers/types';
import { ACTION_SLUGS, actionIdSchema, type ActionId } from '@/lib/ai/actions/types';
import { AiError } from '@/lib/ai/shared/result';
import { OPENAI_MODELS } from './openai';
import {
  MODEL_SLUGS,
  modelActionProfileSchema,
  modelDefinitionSchema,
  modelIdSchema,
  modelSlugSchema,
  modelRouteSchema,
  type ModelActionProfile,
  type ModelDefinition,
  type ModelId,
  type ModelRoute,
} from './types';

export {
  MODEL_SLUGS,
  modelIdSchema,
  modelSlugSchema,
  modelRouteSchema,
  modelActionProfileSchema,
  modelDefinitionSchema,
  type ModelId,
  type ModelSlug,
  type ModelRoute,
  type ModelActionProfile,
  type ModelDefinition,
} from './types';
export { OPENAI_MODELS } from './openai';
export { ANTHROPIC_MODELS } from './anthropic';
export { XAI_MODELS } from './xai';
export { GOOGLE_MODELS } from './google';
export { AZURE_MODELS } from './azure';
export { AWS_MODELS } from './aws';
export { OPENROUTER_MODELS } from './openrouter';

export const MODEL_REGISTRY = {
  ...OPENAI_MODELS,
} satisfies Record<ModelId, ModelDefinition>;

export function getModel(modelId: ModelId): ModelDefinition {
  const model = (MODEL_REGISTRY as Record<string, ModelDefinition>)[modelId];
  if (!model) throw new AiError('unknown_model', `Unknown model id: ${modelId}`);
  return model;
}

/** All models (enabled or not) whose definition claims support for the action. */
export function getModelsForAction(actionId: ActionId): readonly ModelDefinition[] {
  return Object.values<ModelDefinition>(MODEL_REGISTRY).filter((model) => model.actions.includes(actionId));
}

export function getRoutesForModel(modelId: ModelId): readonly ModelRoute[] {
  return getModel(modelId).routes;
}

/**
 * Verifies registry consistency: every MODEL_SLUGS entry present, no unknown
 * keys, dot notation, known providers/actions on every route, an action
 * profile for every claimed action, all scores within [0, 1].
 */
export function assertModelRegistryIntegrity(): void {
  const knownProviders = new Set<string>(PROVIDER_SLUGS);
  const knownActions = new Set<string>(ACTION_SLUGS);

  const seen = new Set<string>();
  for (const id of MODEL_SLUGS) {
    if (seen.has(id)) throw new Error(`Duplicate model slug in MODEL_SLUGS: ${id}`);
    seen.add(id);
    if (!modelSlugSchema.safeParse(id).success) throw new Error(`Invalid model slug: ${id}`);
  }

  const registryKeys = Object.keys(MODEL_REGISTRY);
  for (const id of MODEL_SLUGS) {
    if (!registryKeys.includes(id)) throw new Error(`MODEL_REGISTRY is missing model: ${id}`);
  }
  for (const key of registryKeys) {
    if (!seen.has(key)) throw new Error(`MODEL_REGISTRY contains unknown model id: ${key}`);
  }

  for (const [key, model] of Object.entries(MODEL_REGISTRY)) {
    const parsed = modelDefinitionSchema.parse(model);
    if (parsed.id !== key) throw new Error(`MODEL_REGISTRY key ${key} does not match its definition id ${parsed.id}`);

    for (const route of parsed.routes) {
      if (!knownProviders.has(route.providerId)) {
        throw new Error(`Model ${key} has a route to unknown provider: ${route.providerId}`);
      }
    }

    for (const actionId of parsed.actions) {
      if (!knownActions.has(actionId)) throw new Error(`Model ${key} claims unknown action: ${actionId}`);
      if (!parsed.actionProfiles[actionId]) {
        throw new Error(`Model ${key} claims action ${actionId} without an action profile`);
      }
    }

    for (const profileActionId of Object.keys(parsed.actionProfiles)) {
      const actionParse = actionIdSchema.safeParse(profileActionId);
      if (!actionParse.success) throw new Error(`Model ${key} has a profile for unknown action: ${profileActionId}`);
      if (!parsed.actions.includes(actionParse.data)) {
        throw new Error(`Model ${key} has a profile for action ${profileActionId} it does not claim`);
      }
    }
  }
}
