import { z } from 'zod';
import { azureAIFoundryProviderFactory } from './azure-ai-foundry';
import { awsPollyProviderFactory } from './aws-polly';
import { googleVertexProviderFactory } from './google-vertex';
import { PROVIDER_NAMES, PROVIDER_SLUGS, type ProviderAdapter, type ProviderFactory, type ProviderId } from './types';

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderRegistration {
  id: ProviderId;
  name: string;
  factory: ProviderFactory;
  resolveConfig(env: ProviderEnvironment): unknown;
}

export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderRegistration>> = {
  'google-vertex': { id: 'google-vertex', name: PROVIDER_NAMES['google-vertex'], factory: googleVertexProviderFactory, resolveConfig: (env) => ({ ...(env.GOOGLE_VERTEX_API_KEY ? { apiKey: env.GOOGLE_VERTEX_API_KEY } : {}), ...(env.GOOGLE_VERTEX_ACCESS_TOKEN ? { accessToken: env.GOOGLE_VERTEX_ACCESS_TOKEN } : {}), ...(env.GOOGLE_VERTEX_PROJECT_ID ? { projectId: env.GOOGLE_VERTEX_PROJECT_ID } : {}), ...(env.GOOGLE_VERTEX_LOCATION ? { location: env.GOOGLE_VERTEX_LOCATION } : {}) }) },
  'azure-ai-foundry': { id: 'azure-ai-foundry', name: PROVIDER_NAMES['azure-ai-foundry'], factory: azureAIFoundryProviderFactory, resolveConfig: (env) => ({ apiKey: env.AZURE_OPENAI_API_KEY, endpoint: env.AZURE_OPENAI_ENDPOINT }) },
  'aws-polly': { id: 'aws-polly', name: PROVIDER_NAMES['aws-polly'], factory: awsPollyProviderFactory, resolveConfig: (env) => ({ region: env.AWS_POLLY_REGION ?? 'eu-central-1', ...(env.AWS_POLLY_ENDPOINT ? { endpoint: env.AWS_POLLY_ENDPOINT } : {}), ...(env.AWS_POLLY_PROFILE ? { profile: env.AWS_POLLY_PROFILE } : {}) }) },
};

export const MODEL_REGISTRY = [
  { id: 'google.gemini-3.7-flash', name: 'Gemini 3.7 Flash', description: 'General-purpose reasoning and multimodal model.' },
  { id: 'google.gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', description: 'Low-latency general-purpose text model.' },
  { id: 'google.gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash-Lite Image', description: 'Low-latency image generation model.' },
  { id: 'amazon.polly-neural', name: 'Amazon Polly Neural', description: 'Stable neural speech synthesis with native MP3 output.' },
  { id: 'openai.text-embedding-3-small', name: 'OpenAI Text Embedding 3 Small', description: 'Text embedding model.' },
] as const;
export type ModelId = (typeof MODEL_REGISTRY)[number]['id'];
export const MODEL_IDS = MODEL_REGISTRY.map(({ id }) => id) as readonly ModelId[];
export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);

const EXTERNAL_MODEL_IDS = {
  'google.gemini-3.7-flash:google-vertex': 'gemini-3.7-flash',
  'google.gemini-3.5-flash-lite:google-vertex': 'gemini-3.5-flash-lite',
  'google.gemini-3.1-flash-lite-image:google-vertex': 'gemini-3.1-flash-lite-image',
  'amazon.polly-neural:aws-polly': 'neural',
  'openai.text-embedding-3-small:azure-ai-foundry': 'text-embedding-3-small',
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
