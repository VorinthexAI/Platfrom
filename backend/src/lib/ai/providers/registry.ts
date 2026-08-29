import { z } from 'zod';
import { anthropicProviderFactory } from './anthropic';
import { awsBedrockProviderFactory } from './aws-bedrock';
import { awsBedrockMantleProviderFactory } from './aws-bedrock-mantle';
import { azureAIFoundryProviderFactory } from './azure-ai-foundry';
import { googleVertexProviderFactory } from './google-vertex';
import { openAIProviderFactory } from './openai';
import { openRouterProviderFactory } from './openrouter';
import { xaiProviderFactory } from './xai';
import { PROVIDER_NAMES, PROVIDER_SLUGS, type ProviderAdapter, type ProviderFactory, type ProviderId } from './types';

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderRegistration {
  id: ProviderId;
  name: string;
  factory: ProviderFactory;
  resolveConfig(env: ProviderEnvironment): unknown;
}

const bedrockConfig = (env: ProviderEnvironment) => ({
  region: env.BEDROCK_REGION ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
  accessKeyId: env.BEDROCK_AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY,
});

export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderRegistration>> = {
  openai: { id: 'openai', name: PROVIDER_NAMES.openai, factory: openAIProviderFactory, resolveConfig: (env) => ({ apiKey: env.OPENAI_API_KEY, ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}), ...(env.OPENAI_ORGANIZATION ? { organization: env.OPENAI_ORGANIZATION } : {}), ...(env.OPENAI_PROJECT ? { project: env.OPENAI_PROJECT } : {}) }) },
  openrouter: { id: 'openrouter', name: PROVIDER_NAMES.openrouter, factory: openRouterProviderFactory, resolveConfig: (env) => ({ apiKey: env.OPENROUTER_API_KEY, ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}) }) },
  anthropic: { id: 'anthropic', name: PROVIDER_NAMES.anthropic, factory: anthropicProviderFactory, resolveConfig: (env) => ({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseUrl: env.ANTHROPIC_BASE_URL } : {}) }) },
  xai: { id: 'xai', name: PROVIDER_NAMES.xai, factory: xaiProviderFactory, resolveConfig: (env) => ({ apiKey: env.XAI_API_KEY, ...(env.XAI_BASE_URL ? { baseUrl: env.XAI_BASE_URL } : {}) }) },
  'google-vertex': { id: 'google-vertex', name: PROVIDER_NAMES['google-vertex'], factory: googleVertexProviderFactory, resolveConfig: (env) => ({ ...(env.GOOGLE_VERTEX_API_KEY ? { apiKey: env.GOOGLE_VERTEX_API_KEY } : {}), ...(env.GOOGLE_VERTEX_ACCESS_TOKEN ? { accessToken: env.GOOGLE_VERTEX_ACCESS_TOKEN } : {}), ...(env.GOOGLE_VERTEX_PROJECT_ID ? { projectId: env.GOOGLE_VERTEX_PROJECT_ID } : {}), ...(env.GOOGLE_VERTEX_LOCATION ? { location: env.GOOGLE_VERTEX_LOCATION } : {}) }) },
  'azure-ai-foundry': { id: 'azure-ai-foundry', name: PROVIDER_NAMES['azure-ai-foundry'], factory: azureAIFoundryProviderFactory, resolveConfig: (env) => ({ apiKey: env.AZURE_OPENAI_API_KEY, endpoint: env.AZURE_OPENAI_ENDPOINT, ...(env.AZURE_OPENAI_API_VERSION ? { apiVersion: env.AZURE_OPENAI_API_VERSION } : {}) }) },
  'aws-bedrock': { id: 'aws-bedrock', name: PROVIDER_NAMES['aws-bedrock'], factory: awsBedrockProviderFactory, resolveConfig: bedrockConfig },
  'aws-bedrock-mantle': { id: 'aws-bedrock-mantle', name: PROVIDER_NAMES['aws-bedrock-mantle'], factory: awsBedrockMantleProviderFactory, resolveConfig: bedrockConfig },
};

export const MODEL_REGISTRY = [
  { id: 'openai.gpt-5.6-luna', name: 'OpenAI GPT-5.6 Luna', description: 'General-purpose reasoning and multimodal model.' },
  { id: 'openai.gpt-image-2', name: 'OpenAI GPT Image 2', description: 'Image generation and editing model.' },
  { id: 'openai.gpt-4o-mini-tts', name: 'OpenAI GPT-4o Mini TTS', description: 'Speech generation model.' },
  { id: 'openai.text-embedding-3-small', name: 'OpenAI Text Embedding 3 Small', description: 'Text embedding model.' },
  { id: 'bfl.flux-2-klein-4b', name: 'FLUX.2 Klein 4B', description: 'Low-latency image generation model.' },
  { id: 'xai.grok-imagine-image-quality', name: 'Grok Imagine Image Quality', description: 'Quality-focused image generation model.' },
  { id: 'google.gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Fast text generation model.' },
] as const;
export type ModelId = (typeof MODEL_REGISTRY)[number]['id'];
export const MODEL_IDS = MODEL_REGISTRY.map(({ id }) => id) as readonly ModelId[];
export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);

const EXTERNAL_MODEL_IDS = {
  'openai.gpt-5.6-luna:openai': 'gpt-5.6-luna',
  'openai.gpt-image-2:openai': 'gpt-image-2',
  'openai.gpt-4o-mini-tts:openai': 'gpt-4o-mini-tts',
  'openai.text-embedding-3-small:openai': 'text-embedding-3-small',
  'bfl.flux-2-klein-4b:openrouter': 'black-forest-labs/flux.2-klein-4b',
  'xai.grok-imagine-image-quality:openrouter': 'x-ai/grok-imagine-image-quality',
  'google.gemini-2.5-flash-lite:openrouter': 'google/gemini-2.5-flash-lite',
} as const;

export function getModel(id: string) { return MODEL_REGISTRY.find((model) => model.id === id); }
export function getExternalModelId(modelId: string, providerId: ProviderId): string | undefined {
  return (EXTERNAL_MODEL_IDS as Readonly<Record<string, string>>)[`${modelId}:${providerId}`];
}
function resolveProviderConfig(providerId: ProviderId, env: ProviderEnvironment): unknown | undefined {
  const provider = PROVIDER_REGISTRY[providerId];
  const parsed = provider.factory.configSchema.safeParse(provider.resolveConfig(env));
  return parsed.success ? parsed.data : undefined;
}
export function createRegisteredProviderAdapter(providerId: ProviderId, env: ProviderEnvironment = process.env): ProviderAdapter | undefined {
  const config = resolveProviderConfig(providerId, env);
  return config === undefined ? undefined : PROVIDER_REGISTRY[providerId].factory.create(config);
}
export function isProviderAvailable(providerId: ProviderId, env: ProviderEnvironment = process.env): boolean {
  return resolveProviderConfig(providerId, env) !== undefined;
}
export function assertProviderRegistryIntegrity(): void {
  const providers = Object.values(PROVIDER_REGISTRY);
  if (new Set(providers.map(({ id }) => id)).size !== providers.length || providers.some(({ id }, index) => id !== PROVIDER_SLUGS[index])) throw new Error('Provider registry IDs must be unique and match PROVIDER_SLUGS');
  if (new Set(MODEL_IDS).size !== MODEL_IDS.length) throw new Error('Model registry IDs must be unique');
  for (const [pair, externalId] of Object.entries(EXTERNAL_MODEL_IDS)) {
    const [modelId, providerId] = pair.split(':');
    if (!getModel(modelId!) || !PROVIDER_REGISTRY[providerId as ProviderId] || !externalId.trim()) throw new Error(`Invalid model/provider registration: ${pair}`);
  }
}
