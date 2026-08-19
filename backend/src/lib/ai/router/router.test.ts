import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { modelSchema, type Model } from '@/lib/db/models.node';
import { modelActionSchema, type ModelAction } from '@/lib/db/model-actions.node';
import { modelProviderSchema, type ModelProvider } from '@/lib/db/model-providers.node';
import { providerSchema, type Provider } from '@/lib/db/providers.node';
import type { ProviderAdapter } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
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
    modelActionSchema.parse({ key: newId(), modelKey: nano.key, actionSlug: 'chat', priority: 100, enabled: true }),
    modelActionSchema.parse({ key: newId(), modelKey: mini.key, actionSlug: 'reason', priority: 100, enabled: true }),
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
  test('routes registered actions directly by slug', async () => {
    const deps = fixture();
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, deps)).modelSlug).toBe('openai.gpt-5.4-nano');
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'reason' }, deps)).modelSlug).toBe('openai.gpt-5.4-mini');
  });

  test('uses descending modelAction priority with deterministic key tie-breaking', async () => {
    const base = fixture();
    const low = modelActionSchema.parse({ key: newId(), modelKey: base.nano.key, actionSlug: 'chat', priority: 10, enabled: true });
    const high = modelActionSchema.parse({ key: newId(), modelKey: base.mini.key, actionSlug: 'chat', priority: 100, enabled: true });
    const deps = fixture({ modelActions: [low, high], models: [base.nano, base.mini] });
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, deps)).modelKey).toBe(base.mini.key);

    const tied = fixture();
    const left = modelActionSchema.parse({ key: newId(), modelKey: tied.nano.key, actionSlug: 'chat', priority: 50, enabled: true });
    const right = modelActionSchema.parse({ key: newId(), modelKey: tied.mini.key, actionSlug: 'chat', priority: 50, enabled: true });
    tied.data!.listModelActions = async () => [right, left];
    const expected = left.key.localeCompare(right.key) < 0 ? left.modelKey : right.modelKey;
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, tied)).modelKey).toBe(expected);
  });

  test('uses environment-backed OpenAI without organization credentials', async () => {
    const deps = fixture({ allowed: [] });
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, deps)).resolves.toMatchObject({ providerSlug: 'openai', credentialSource: 'environment' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'chat', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps)).resolves.toMatchObject({ providerSlug: 'openai', credentialSource: 'environment' });
  });

  test('routes every action supported by a static provider without an organization provider', async () => {
    const embeddingModel = model('qwen.qwen3-embedding-8b');
    const openrouter = providerSchema.parse({ key: newId(), slug: 'openrouter', name: 'OpenRouter', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openrouter', enabled: true });
    const modelActions = ['embed', 'reason'].map((actionSlug) => modelActionSchema.parse({ key: newId(), modelKey: embeddingModel.key, actionSlug, priority: 100, enabled: true }));
    const modelProvider = modelProviderSchema.parse({ key: newId(), modelKey: embeddingModel.key, providerKey: openrouter.key, providerModelId: 'qwen/qwen3-embedding-8b', enabled: true });
    const data: RouterDataSource = {
      async getModelBySlug(slug) { return slug === embeddingModel.slug ? embeddingModel : null; },
      async getModelByKey(key) { return key === embeddingModel.key ? embeddingModel : null; },
      async getProviderBySlug(slug) { return slug === openrouter.slug ? openrouter : null; },
      async getProviderByKey(key) { return key === openrouter.key ? openrouter : null; },
      async listModelActions(actionSlug) { return modelActions.filter((entry) => entry.actionSlug === actionSlug); },
      async listModelProviders(modelKey) { return modelKey === embeddingModel.key ? [modelProvider] : []; },
      async listOrganizationProviderKeys() { return []; },
    };

    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'reason' }, { data })).resolves.toMatchObject({
      actionSlug: 'reason', modelSlug: 'qwen.qwen3-embedding-8b', providerSlug: 'openrouter', credentialSource: 'environment',
    });
  });

  test('selects the persisted GPT Image 2 OpenRouter route for generate-image', async () => {
    const imageModel = model('openai.gpt-image-2');
    const openrouter = providerSchema.parse({ key: newId(), slug: 'openrouter', name: 'OpenRouter', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openrouter', enabled: true });
    const binding = modelActionSchema.parse({ key: newId(), modelKey: imageModel.key, actionSlug: 'generate-image', priority: 100, enabled: true });
    const route = modelProviderSchema.parse({ key: newId(), modelKey: imageModel.key, providerKey: openrouter.key, providerModelId: 'openai/gpt-image-2', enabled: true });
    const data: RouterDataSource = {
      async getModelBySlug(slug) { return slug === imageModel.slug ? imageModel : null; },
      async getModelByKey(key) { return key === imageModel.key ? imageModel : null; },
      async getProviderBySlug(slug) { return slug === openrouter.slug ? openrouter : null; },
      async getProviderByKey(key) { return key === openrouter.key ? openrouter : null; },
      async listModelActions(actionSlug) { return actionSlug === 'generate-image' ? [binding] : []; },
      async listModelProviders(modelKey) { return modelKey === imageModel.key ? [route] : []; },
      async listOrganizationProviderKeys() { return []; },
    };

    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'generate-image' }, { data })).resolves.toMatchObject({
      actionSlug: 'generate-image',
      modelSlug: 'openai.gpt-image-2',
      providerSlug: 'openrouter',
      providerModelId: 'openai/gpt-image-2',
      credentialSource: 'environment',
    });
  });

  test('model and fixed modes never silently change their requested route', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'chat', modelSlug: 'openai.gpt-5.4-mini' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
    const fixed = await selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'chat', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps);
    expect(fixed).toMatchObject({ modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' });
  });

  test('filters disabled relation nodes even when a data source returns them', async () => {
    const deps = fixture();
    deps.data!.listModelActions = async (actionSlug) => [modelActionSchema.parse({ key: newId(), modelKey: deps.nano.key, actionSlug, priority: 100, enabled: false })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);

    const enabledDeps = fixture();
    enabledDeps.data!.listModelProviders = async (modelKey) => [modelProviderSchema.parse({ key: newId(), modelKey, providerKey: openai.key, providerModelId: 'gpt-5.4-nano', enabled: false })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'chat' }, enabledDeps)).rejects.toBeInstanceOf(NoEligibleRouteError);
  });
});
