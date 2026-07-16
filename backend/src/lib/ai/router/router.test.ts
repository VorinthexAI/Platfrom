import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { actionSchema, type Action } from '@/lib/db/actions.node';
import { modelSchema, type Model } from '@/lib/db/models.node';
import { modelActionSchema, type ModelAction } from '@/lib/db/model-actions.node';
import { modelProviderSchema, type ModelProvider } from '@/lib/db/model-providers.node';
import { providerSchema, type Provider } from '@/lib/db/providers.node';
import type { ProviderAdapter } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import type { RouterDataSource, RouterDependencies } from './types';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError } from './errors';

const organizationKey = newId();
function action(slug: Action['slug']): Action { return actionSchema.parse({ key: newId(), slug, name: slug, description: 'Action description', objective: 'Execute action', inputDescription: 'Input', outputDescription: 'Output', handlerKey: slug, enabled: true }); }
function model(slug: string): Model { return modelSchema.parse({ key: newId(), slug, name: slug, description: 'Model', supportedUseCases: 'Agent execution', enabled: true }); }
const openai = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai', enabled: true });
const adapter: ProviderAdapter = { id: 'openai', name: 'OpenAI', async execute() { throw new Error('not executed in selection tests'); } };

function fixture(overrides: { allowed?: string[]; modelActions?: ModelAction[]; modelProviders?: ModelProvider[]; models?: Model[]; providers?: Provider[] } = {}): RouterDependencies & { ask: Action; reason: Action; nano: Model; mini: Model } {
  const ask = action('core.ask');
  const reason = action('core.reason');
  const nano = model('openai.gpt-5.4-nano');
  const mini = model('openai.gpt-5.4-mini');
  const models = overrides.models ?? [nano, mini];
  const providers = overrides.providers ?? [openai];
  const modelActions = overrides.modelActions ?? [
    modelActionSchema.parse({ key: newId(), modelKey: nano.key, actionKey: ask.key, priority: 100, enabled: true }),
    modelActionSchema.parse({ key: newId(), modelKey: mini.key, actionKey: reason.key, priority: 100, enabled: true }),
  ];
  const modelProviders = overrides.modelProviders ?? models.map((entry) => modelProviderSchema.parse({ key: newId(), modelKey: entry.key, providerKey: openai.key, providerModelId: entry.slug.replace('openai.', ''), enabled: true }));
  const actions = [ask, reason];
  const data: RouterDataSource = {
    async getActionBySlug(slug) { return actions.find((entry) => entry.slug === slug) ?? null; },
    async getModelBySlug(slug) { return models.find((entry) => entry.slug === slug) ?? null; },
    async getModelByKey(key) { return models.find((entry) => entry.key === key) ?? null; },
    async getProviderBySlug(slug) { return providers.find((entry) => entry.slug === slug) ?? null; },
    async getProviderByKey(key) { return providers.find((entry) => entry.key === key) ?? null; },
    async listModelActions(actionKey) { return modelActions.filter((entry) => entry.actionKey === actionKey).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)); },
    async listModelProviders(modelKey) { return modelProviders.filter((entry) => entry.modelKey === modelKey).sort((a, b) => a.providerKey.localeCompare(b.providerKey)); },
    async listOrganizationProviderKeys() { return overrides.allowed ?? [openai.key]; },
  };
  return { data, adapters: { openai: adapter }, ask, reason, nano, mini };
}

describe('priority-only persisted router', () => {
  test('routes Ask only to Nano and Reason only to Mini in v1', async () => {
    const deps = fixture();
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, deps)).modelSlug).toBe('openai.gpt-5.4-nano');
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.reason' }, deps)).modelSlug).toBe('openai.gpt-5.4-mini');
  });

  test('uses descending modelAction priority with deterministic key tie-breaking', async () => {
    const base = fixture();
    const low = modelActionSchema.parse({ key: newId(), modelKey: base.nano.key, actionKey: base.ask.key, priority: 10, enabled: true });
    const high = modelActionSchema.parse({ key: newId(), modelKey: base.mini.key, actionKey: base.ask.key, priority: 100, enabled: true });
    const deps = fixture({ modelActions: [low, high], models: [base.nano, base.mini] });
    // Rebind the generated fixture action keys to its own Ask action.
    const own = deps.data!;
    const ask = await own.getActionBySlug('core.ask');
    const links = [modelActionSchema.parse({ ...low, actionKey: ask!.key }), modelActionSchema.parse({ ...high, actionKey: ask!.key })];
    own.listModelActions = async () => links.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, deps)).modelKey).toBe(base.mini.key);

    const tied = fixture();
    const tiedAsk = await tied.data!.getActionBySlug('core.ask');
    const left = modelActionSchema.parse({ key: newId(), modelKey: tied.nano.key, actionKey: tiedAsk!.key, priority: 50, enabled: true });
    const right = modelActionSchema.parse({ key: newId(), modelKey: tied.mini.key, actionKey: tiedAsk!.key, priority: 50, enabled: true });
    tied.data!.listModelActions = async () => [right, left];
    const expected = left.key.localeCompare(right.key) < 0 ? left.modelKey : right.modelKey;
    expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, tied)).modelKey).toBe(expected);
  });

  test('never bypasses organizationProviders, including fixed mode', async () => {
    const deps = fixture({ allowed: [] });
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'core.ask', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps)).rejects.toBeInstanceOf(ProviderNotEnabledForOrganizationError);
  });

  test('model and fixed modes never silently change their requested route', async () => {
    const deps = fixture();
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'core.ask', modelSlug: 'openai.gpt-5.4-mini' }, deps)).rejects.toBeInstanceOf(NoEligibleRouteError);
    const fixed = await selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'core.ask', modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' }, deps);
    expect(fixed).toMatchObject({ modelSlug: 'openai.gpt-5.4-nano', providerSlug: 'openai' });
  });

  test('filters disabled relation nodes even when a data source returns them', async () => {
    const deps = fixture();
    deps.data!.listModelActions = async (actionKey) => [modelActionSchema.parse({
      key: newId(), modelKey: deps.nano.key, actionKey, priority: 100, enabled: false,
    })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, deps))
      .rejects.toBeInstanceOf(NoEligibleRouteError);

    const enabledDeps = fixture();
    enabledDeps.data!.listModelProviders = async (modelKey) => [modelProviderSchema.parse({
      key: newId(), modelKey, providerKey: openai.key, providerModelId: 'gpt-5.4-nano', enabled: false,
    })];
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'core.ask' }, enabledDeps))
      .rejects.toBeInstanceOf(NoEligibleRouteError);
  });
});
