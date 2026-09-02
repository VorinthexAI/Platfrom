import { z } from 'zod';
import { openRouterProviderFactory } from './openrouter';
import { PROVIDER_NAMES, PROVIDER_SLUGS, type ProviderAdapter, type ProviderFactory, type ProviderId } from './types';

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderRegistration {
  id: ProviderId;
  name: string;
  factory: ProviderFactory;
  resolveConfig(env: ProviderEnvironment): unknown;
}

export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderRegistration>> = {
  openrouter: { id: 'openrouter', name: PROVIDER_NAMES.openrouter, factory: openRouterProviderFactory, resolveConfig: (env) => ({ apiKey: env.OPENROUTER_API_KEY, ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}), appUrl: 'https://vorinthex.com', appName: 'Vorinthex' }) },
};

export const MODEL_REGISTRY = [
  { id: 'google.gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', description: 'Low-latency general-purpose and multimodal text model.' },
  { id: 'google.gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', description: 'Fast image generation, editing, and multimodal analysis model.' },
  { id: 'xai.grok-voice-tts-1.0', name: 'Grok Voice TTS 1.0', description: 'Speech generation model with native MP3 output.' },
  { id: 'openai.text-embedding-3-small', name: 'OpenAI Text Embedding 3 Small', description: 'Text embedding model.' },
] as const;
export type ModelId = (typeof MODEL_REGISTRY)[number]['id'];
export const MODEL_IDS = MODEL_REGISTRY.map(({ id }) => id) as readonly ModelId[];
export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);

const EXTERNAL_MODEL_IDS = {
  'google.gemini-3.1-flash-lite:openrouter': 'google/gemini-3.1-flash-lite',
  'google.gemini-3.1-flash-lite-image:openrouter': 'google/gemini-3.1-flash-lite-image',
  'xai.grok-voice-tts-1.0:openrouter': 'x-ai/grok-voice-tts-1.0',
  'openai.text-embedding-3-small:openrouter': 'openai/text-embedding-3-small',
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
