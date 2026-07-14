import type { ModelDefinition, ModelId } from './types';

/**
 * Azure AI Foundry exposes the same logical models as their upstream
 * vendors, so azure routes live on those models (see the disabled
 * azure-ai-foundry route on `openai.gpt-5` in ./openai.ts). No model exists
 * ONLY through Azure today; when one does, define it here.
 */
export const AZURE_MODELS = {} satisfies Partial<Record<ModelId, ModelDefinition>>;
