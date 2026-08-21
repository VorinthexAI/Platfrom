import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { modelSchema, type Model } from '@/lib/db/models.node';
import { modelActionSchema, type ModelAction } from '@/lib/db/model-actions.node';
import { modelProviderSchema, type ModelProvider } from '@/lib/db/model-providers.node';
import { providerSchema, type Provider } from '@/lib/db/providers.node';
import type { ProviderAdapter } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import { executeAsk, executeWebSearch } from './execute-route';
import type { RouterDataSource, RouterDependencies } from './types';
import { NoEligibleRouteError } from './errors';

const organizationKey = newId();
function model(slug: string): Model { return modelSchema.parse({ key: newId(), slug, name: slug, description: 'Model', supportedUseCases: 'Agent execution', enabled: true }); }
const openai = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai', enabled: true });
const adapter: ProviderAdapter = { id: 'openai', name: 'OpenAI', async execute() { throw new Error('not executed in selection tests'); } };

function fixture(overrides: { allowed?: string[]; modelActions?: ModelAction[]; modelProviders?: ModelProvider[]; models?: Model[]; providers?: Provider[] } = {}): RouterDependencies & { nano: Model; mini: Model } {
  const nano = model('openai.gpt-5.4-nano');
  const mini = model('openai.gpt-5.4-mini');
  const models = overrides.models ?? [nano, mini];
  const providers = overrides.providers ?? [openai];
  const modelActions = overrides.modelActions ?? [
    modelActionSchema.parse({ key: newId(), modelKey: nano.key, actionSlug: 'ask', priority: 100, enabled: true }),
    modelActionSchema.parse({ key: newId(), modelKey: mini.key, actionSlug: 'embed', priority: 100, enabled: true }),
  ];
  const modelProviders = overrides.modelProviders ?? models.map((entry) => modelProviderSchema.parse({ key: newId(), modelKey: entry.key, providerKey: openai.key, providerModelId: entry.slug.replace('openai.', ''), enabled: true }));
  const data: RouterDataSource = {
    async getModelBySlug(slug) { return models.find((entry) => entry.slug === slug) ?? null; },
    async getModelByKey(key) { return models.find((entry) => entry.key === key) ?? null; },
    async getProviderBySlug(slug) { return providers.find((entry) => entry.slug === slug) ?? null; },
    async getProviderByKey(key) { return providers.find((entry) => entry.key === key) ?? null; },
    async listModelActions(actionSlug) { return modelActions.filter((entry) => entry.actionSlug === actionSlug).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)); },
    async listModelProviders(modelKey) { return modelProviders.filter((entry) => entry.modelKey === modelKey).sort((a, b) => a.providerKey.localeCompare(b.providerKey)); },
    async listOrganizationProviderKeys() { return overrides.allowed ?? [openai.key]; },
  };
  return { data, adapters: { openai: adapter }, nano, mini };
}

describe('priority-only persisted router', () => {
  test('routes omitted/default ask to Flash Lite and explicit deep ask to Luna without forwarding mode', async () => {
    const flash = model('google.gemini-2.5-flash-lite');
    const luna = model('openai.gpt-5.6-luna');
    const openrouter = providerSchema.parse({ key: newId(), slug: 'openrouter', name: 'OpenRouter', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openrouter', enabled: true });
    const models = [flash, luna], providers = [openrouter, openai];
    const modelActions = models.flatMap((entry, index) => ['ask', 'web-search'].map((actionSlug) => modelActionSchema.parse({ key: newId(), modelKey: entry.key, actionSlug, priority: 100 - index, enabled: true })));
    const modelProviders = [
      modelProviderSchema.parse({ key: newId(), modelKey: flash.key, providerKey: openrouter.key, providerModelId: 'google/gemini-2.5-flash-lite', enabled: true }),
      modelProviderSchema.parse({ key: newId(), modelKey: luna.key, providerKey: openai.key, providerModelId: 'gpt-5.6-luna', enabled: true }),
    ];
    const data: RouterDataSource = {
      async getModelBySlug(slug) { return models.find((entry) => entry.slug === slug) ?? null; }, async getModelByKey(key) { return models.find((entry) => entry.key === key) ?? null; },
      async getProviderBySlug(slug) { return providers.find((entry) => entry.slug === slug) ?? null; }, async getProviderByKey(key) { return providers.find((entry) => entry.key === key) ?? null; },
    async listModelActions(actionSlug) { return modelActions.filter((entry) => entry.actionSlug === actionSlug); }, async listModelProviders(modelKey) { return modelProviders.filter((entry) => entry.modelKey === modelKey); }, async listOrganizationProviderKeys() { return [openrouter.key, openai.key]; },
    };
    const calls: Array<{ provider: string; model: string; input: unknown }> = [];
    const makeAdapter = (id: 'openai' | 'openrouter'): ProviderAdapter => ({ id, name: id, async execute<TInput, TOutput>(request: import('@/lib/ai/providers').ProviderExecuteRequest<TInput>) { calls.push({ provider: id, model: request.modelId, input: request.input }); return { output: { text: 'ok', toolCalls: [], stopReason: 'stop' } as TOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: id, modelId: request.modelId, externalModelId: request.externalModelId }; } });
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    await executeAsk(organizationKey, input, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } });
    await executeAsk(organizationKey, { ...input, mode: 'deep' }, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } });
    await executeAsk(organizationKey, { ...input, organizationProviderKey: openrouter.key }, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } });
    await expect(executeAsk(organizationKey, { ...input, organizationProviderKey: openai.key }, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await executeWebSearch(organizationKey, { prompt: 'Current facts' }, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } });
    await executeWebSearch(organizationKey, { prompt: 'Current facts', mode: 'deep' }, { data, adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } });
    await expect(executeAsk(organizationKey, { ...input, mode: 'deep', organizationProviderKey: openrouter.key }, { data })).rejects.toThrow('cannot be combined');
    expect(calls.map(({ provider, model }) => [provider, model])).toEqual([['openrouter', 'google.gemini-2.5-flash-lite'], ['openai', 'openai.gpt-5.6-luna'], ['openrouter', 'google.gemini-2.5-flash-lite'], ['openrouter', 'google.gemini-2.5-flash-lite'], ['openai', 'openai.gpt-5.6-luna']]);
    expect(calls.every(({ input: value }) => !('mode' in (value as Record<string, unknown>)))).toBe(true);
    expect(calls.every(({ input: value }) => !('organizationProviderKey' in (value as Record<string, unknown>)))).toBe(true);
  });

  test('routes registered actions directly by slug', async () => {
    const deps = fixture();
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).modelSlug).toBe('openai.gpt-5.4-nano');
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'embed' }, deps)).modelSlug).toBe('openai.gpt-5.4-mini');
  });

  test('uses descending modelAction priority with deterministic key tie-breaking', async () => {
    const base = fixture();
    const low = modelActionSchema.parse({ key: newId(), modelKey: base.nano.key, actionSlug: 'ask', priority: 10, enabled: true });
    const high = modelActionSchema.parse({ key: newId(), modelKey: base.mini.key, actionSlug: 'ask', priority: 100, enabled: true });
    const deps = fixture({ modelActions: [low, high], models: [base.nano, base.mini] });
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).modelKey).toBe(base.mini.key);

    const tied = fixture();
    const left = modelActionSchema.parse({ key: newId(), modelKey: tied.nano.key, actionSlug: 'ask', priority: 50, enabled: true });
    const right = modelActionSchema.parse({ key: newId(), modelKey: tied.mini.key, actionSlug: 'ask', priority: 50, enabled: true });
    tied.data!.listModelActions = async () => [right, left];
    const expected = left.key.localeCompare(right.key) < 0 ? left.modelKey : right.modelKey;
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, tied)).modelKey).toBe(expected);
  });

  test('uses environment-backed OpenAI without organization credentials', async () => {
    const deps = fixture({ allowed: [] });
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).resolves.toMatchObject({ providerSlug: 'openai', credentialSource: 'environment' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps)).resolves.toMatchObject({ providerSlug: 'openai', credentialSource: 'environment' });
  });

  test('routes every action supported by a static provider without an organization provider', async () => {
    const embeddingModel = model('openai.text-embedding-3-small');
    const openai = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai', enabled: true });
    const modelActions = ['embed'].map((actionSlug) => modelActionSchema.parse({ key: newId(), modelKey: embeddingModel.key, actionSlug, priority: 100, enabled: true }));
    const modelProvider = modelProviderSchema.parse({ key: newId(), modelKey: embeddingModel.key, providerKey: openai.key, providerModelId: 'text-embedding-3-small', enabled: true });
    const data: RouterDataSource = {
      async getModelBySlug(slug) { return slug === embeddingModel.slug ? embeddingModel : null; },
      async getModelByKey(key) { return key === embeddingModel.key ? embeddingModel : null; },
      async getProviderBySlug(slug) { return slug === openai.slug ? openai : null; },
      async getProviderByKey(key) { return key === openai.key ? openai : null; },
      async listModelActions(actionSlug) { return modelActions.filter((entry) => entry.actionSlug === actionSlug); },
      async listModelProviders(modelKey) { return modelKey === embeddingModel.key ? [modelProvider] : []; },
      async listOrganizationProviderKeys() { return []; },
    };

    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'embed' }, { data })).resolves.toMatchObject({
      actionSlug: 'embed', modelSlug: 'openai.text-embedding-3-small', providerSlug: 'openai', credentialSource: 'environment',
    });
  });

  test('model and fixed modes never silently change their requested route', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.4-mini' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
    const fixed = await selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps);
    expect(fixed).toMatchObject({ modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' });
  });

  test('filters disabled relation nodes even when a data source returns them', async () => {
    const deps = fixture();
    deps.data!.listModelActions = async (actionSlug) => [modelActionSchema.parse({ key: newId(), modelKey: deps.nano.key, actionSlug, priority: 100, enabled: false })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);

    const enabledDeps = fixture();
    enabledDeps.data!.listModelProviders = async (modelKey) => [modelProviderSchema.parse({ key: newId(), modelKey, providerKey: openai.key, providerModelId: 'gpt-5.4-nano', enabled: false })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, enabledDeps)).rejects.toBeInstanceOf(NoEligibleRouteError);
  });
});
