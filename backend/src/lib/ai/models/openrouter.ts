import type { ModelDefinition, ModelId } from './types';

/**
 * OpenRouter is a gateway to models that already have first-party
 * definitions, so openrouter routes live on those models (see the
 * openrouter routes on the OpenAI, Anthropic, and xAI models). No model is
 * exposed ONLY through OpenRouter today; when one is, define it here.
 */
export const OPENROUTER_MODELS = {} satisfies Partial<Record<ModelId, ModelDefinition>>;
