import { describe, expect, test } from 'bun:test';
import { askAction } from '@/lib/ai/actions/ask';
import { newId } from '@/lib/ids';
import { modelSchema, type Model } from '@/lib/db/models.node';
import { modelProviderSchema, type ModelProvider } from '@/lib/db/model-providers.node';
import { providerSchema, type Provider } from '@/lib/db/providers.node';
import type { ProviderAdapter } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import { executeAsk, executeWebSearch } from './execute-route';
import type { RouterDataSource, RouterDependencies } from './types';
import { NoEligibleRouteError } from './errors';

const organizationKey = newId();
const model = (slug: string): Model => modelSchema.parse({ key: newId(), slug, name: slug, description: 'Model', supportedUseCases: 'Agent execution', enabled: true });
const provider = (slug: 'openai' | 'openrouter'): Provider => providerSchema.parse({ key: newId(), slug, name: slug, handlerKey: slug });
const adapter = (id: 'openai' | 'openrouter'): ProviderAdapter => ({ id, name: id, async execute() { throw new Error('not executed in selection tests'); } });

function fixture(overrides: { allowed?: string[]; modelProviders?: ModelProvider[]; models?: Model[]; providers?: Provider[] } = {}): RouterDependencies & {
  flash: Model;
  luna: Model;
  openai: Provider;
  openrouter: Provider;
} {
  const flash = model('google.gemini-2.5-flash-lite');
  const luna = model('openai.gpt-5.6-luna');
  const openai = provider('openai');
  const openrouter = provider('openrouter');
  const models = overrides.models ?? [flash, luna];
  const providers = overrides.providers ?? [openrouter, openai];
  const modelProviders = overrides.modelProviders ?? [
    modelProviderSchema.parse({ key: newId(), modelKey: flash.key, providerKey: openrouter.key, providerModelId: 'google/gemini-2.5-flash-lite', enabled: true }),
    modelProviderSchema.parse({ key: newId(), modelKey: luna.key, providerKey: openai.key, providerModelId: 'gpt-5.6-luna', enabled: true }),
  ];
  const data: RouterDataSource = {
    async getModelBySlug(slug) { return models.find((entry) => entry.slug === slug) ?? null; },
    async getProviderBySlug(slug) { return providers.find((entry) => entry.slug === slug) ?? null; },
    async getProviderByKey(key) { return providers.find((entry) => entry.key === key) ?? null; },
    async listModelProviders(modelKey) { return modelProviders.filter((entry) => entry.modelKey === modelKey); },
    async listOrganizationProviderKeys() { return overrides.allowed ?? [openrouter.key, openai.key]; },
  };
  return { data, adapters: { openai: adapter('openai'), openrouter: adapter('openrouter') }, flash, luna, openai, openrouter };
}

describe('action-definition router', () => {
  test('uses descending code priority and falls back through operational catalog gates', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).resolves.toMatchObject({
      modelSlug: 'google.gemini-2.5-flash-lite',
      providerSlug: 'openrouter',
    });

    deps.data!.listModelProviders = async (modelKey) => modelKey === deps.flash.key ? [] : [
      modelProviderSchema.parse({ key: newId(), modelKey: deps.luna.key, providerKey: deps.openai.key, providerModelId: 'gpt-5.6-luna', enabled: true }),
    ];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).resolves.toMatchObject({
      modelSlug: 'openai.gpt-5.6-luna',
      providerSlug: 'openai',
    });
  });

  test('uses declaration order to break equal code-priority ties', async () => {
    const deps = fixture();
    const bindings = askAction.models as Array<{ provider: 'openai' | 'openrouter'; model: string; priority: number }>;
    const priorities = bindings.map(({ priority }) => priority);
    try {
      bindings[0]!.priority = 50;
      bindings[1]!.priority = 50;
      expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).modelSlug).toBe(bindings[0]!.model);
    } finally {
      bindings.forEach((binding, index) => { binding.priority = priorities[index]!; });
    }
  });

  test('model and fixed modes filter exact declared bindings', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna' }, deps)).resolves.toMatchObject({ providerSlug: 'openai' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite', providerSlug: 'openai' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite', providerSlug: 'openrouter' }, deps)).resolves.toMatchObject({ providerSlug: 'openrouter' });
  });

  test('uses only the exact provider declared for a model binding', async () => {
    const deps = fixture();
    const wrongRelation = modelProviderSchema.parse({ key: newId(), modelKey: deps.flash.key, providerKey: deps.openai.key, providerModelId: 'wrong-provider-model', enabled: true });
    const exactRelation = modelProviderSchema.parse({ key: newId(), modelKey: deps.flash.key, providerKey: deps.openrouter.key, providerModelId: 'exact-provider-model', enabled: true });
    deps.data!.listModelProviders = async (modelKey) => modelKey === deps.flash.key ? [wrongRelation, exactRelation] : [];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).resolves.toMatchObject({
      providerSlug: 'openrouter', providerModelId: 'exact-provider-model',
    });
  });

  test('keeps explicit organization provider identity aligned with the candidate provider', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask', organizationProviderKey: deps.openai.key }, deps)).resolves.toMatchObject({
      modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai', credentialSource: 'organization', orgProviderKey: deps.openai.key,
    });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite', providerSlug: 'openrouter', organizationProviderKey: deps.openai.key }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('retains static provider routing without organization-provider permission', async () => {
    const deps = fixture({ allowed: [] });
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).resolves.toMatchObject({ providerSlug: 'openrouter', credentialSource: 'environment' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' }, deps)).resolves.toMatchObject({ credentialSource: 'environment' });
  });

  test('rejects none and empty model policies before any catalog lookup', async () => {
    let lookups = 0;
    const fail = async () => { lookups += 1; throw new Error('catalog lookup must not run'); };
    const data: RouterDataSource = {
      getModelBySlug: fail, getProviderBySlug: fail, getProviderByKey: fail,
      listModelProviders: fail, listOrganizationProviderKeys: fail,
    };
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'traverse' }, { data })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'extend-video' }, { data })).rejects.toBeInstanceOf(NoEligibleRouteError);
    expect(lookups).toBe(0);
  });

  test('filters disabled model-provider relations returned by a data source', async () => {
    const deps = fixture();
    deps.data!.listModelProviders = async (modelKey) => [modelProviderSchema.parse({ key: newId(), modelKey, providerKey: modelKey === deps.flash.key ? deps.openrouter.key : deps.openai.key, providerModelId: 'disabled', enabled: false })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('executes default and deep action modes without forwarding routing fields', async () => {
    const deps = fixture();
    const calls: Array<{ provider: string; model: string; input: unknown }> = [];
    const makeAdapter = (id: 'openai' | 'openrouter'): ProviderAdapter => ({ id, name: id, async execute<TInput, TOutput>(request: import('@/lib/ai/providers').ProviderExecuteRequest<TInput>) { calls.push({ provider: id, model: request.modelId, input: request.input }); return { output: { text: 'ok', toolCalls: [], stopReason: 'stop' } as TOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: id, modelId: request.modelId, externalModelId: request.externalModelId }; } });
    const options = { ...deps, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } };
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    await executeAsk(organizationKey, input, options);
    await executeAsk(organizationKey, { ...input, mode: 'deep' }, options);
    await executeWebSearch(organizationKey, { prompt: 'Current facts' }, options);
    await executeWebSearch(organizationKey, { prompt: 'Current facts', mode: 'deep' }, options);
    expect(calls.map(({ provider, model }) => [provider, model])).toEqual([
      ['openrouter', 'google.gemini-2.5-flash-lite'], ['openai', 'openai.gpt-5.6-luna'],
      ['openrouter', 'google.gemini-2.5-flash-lite'], ['openai', 'openai.gpt-5.6-luna'],
    ]);
    expect(calls.every(({ input: value }) => !('mode' in (value as Record<string, unknown>)))).toBe(true);
  });
});
