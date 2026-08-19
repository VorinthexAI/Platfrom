import { describe, expect, test } from 'bun:test';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { EMBEDDING_MODEL, EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embedding-constants';
import { providerSchema } from './providers.node';
import { voiceSchema } from './voices.node';
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { join } from 'node:path';
import { NEXUS_SCOPE_KEY, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_ORCHESTRATOR_SOURCES, SEEDED_PROVIDERS, SEEDED_SCOPES, SEEDED_VOICES, reconcileObsoleteSeededModelActions, seedAiRuntimeNodes, type AiRuntimeSeedUpserters, type SeedResult } from './seed';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';

describe('scope seeds', () => {
  test('place products and their Core capability and Command orchestrator children in the Nexus hierarchy', () => {
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === null).map(({ slug }) => slug)).toEqual(['nexus']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual([
      'core',
      'command',
      'hq',
      'pilot',
      'studio',
      'launch',
      'replica',
    ]);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.key).toBe(NEXUS_SCOPE_KEY);
    expect(new Set(SEEDED_SCOPES.map(({ key }) => key)).size).toBe(SEEDED_SCOPES.length);
    const seededKeys = new Set(SEEDED_SCOPES.map(({ key }) => key));
    for (const scope of SEEDED_SCOPES) {
      scopeSchema.parse({ ...scope, organizationKey: newId() });
      if (scope.parentKey) {
        expect(seededKeys.has(scope.parentKey)).toBe(true);
        scopeScopeSchema.parse({ key: newId(), parentKey: scope.parentKey, childKey: scope.key, level: scope.level });
      }
    }
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.position).toBe(1);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.level).toBe(1);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.summary).toBe('Vorinthex is an AI native platform that unifies intelligence, knowledge and execution into a single system that helps people and organizations think, build and achieve more with artificial intelligence.');
    expect(Object.fromEntries(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).map(({ slug, position }) => [slug, position]))).toEqual({ core: 1, command: 2, hq: 3, pilot: 4, studio: 5, launch: 6, replica: 7 });
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).every(({ level }) => level === 2)).toBe(true);
    const core = SEEDED_SCOPES.find(({ slug }) => slug === 'core')!;
    const command = SEEDED_SCOPES.find(({ slug }) => slug === 'command')!;
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === core.key).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['archive', 'gallery', 'signal', 'compass', 'ascend', 'chorus', 'cadence', 'prism']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === command.key).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['atlas', 'hermes', 'metis', 'phoenix', 'apollo', 'iris', 'echo', 'matrix', 'harmony', 'ledger', 'orbit', 'mercury', 'sentinel', 'athena', 'forge', 'aura', 'pillar', 'helios', 'vulcan', 'themis']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === core.key || parentKey === command.key).every(({ level }) => level === 3)).toBe(true);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'hq')).toMatchObject({ name: 'HQ', key: 'cmrnlzf640005qc7kefvra0bn' });
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'archive')).toMatchObject({ summary: 'Capture notes, ideas, research, labels, folders, semantic search, and knowledge graph connections.', description: 'Archive lets you capture, organize, semantically search, and connect your notes through folders, labels, backlinks, and graph traversal.' });
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'atlas')).toMatchObject({ summary: 'Vision, leadership, direction, executive strategy, and company wide decisions.', description: 'Vision, leadership, direction, executive strategy, and company wide decisions.' });
  });

  test('reconciles memberships only after scopes and hierarchy relations exist', async () => {
    const source = await Bun.file(join(import.meta.dir, 'seed.ts')).text();
    const relationCreation = source.indexOf('scopes.addScopeRelation(parent.key, child.key)');
    const membershipReconciliation = source.indexOf('reconcileOrganizationScopeMemberships(rootOrganization.key)');
    expect(relationCreation).toBeGreaterThan(-1);
    expect(membershipReconciliation).toBeGreaterThan(relationCreation);
  });
});

describe('provider seeds', () => {
  test('seed every supported provider while keeping its slug registered', () => {
    const slugs = SEEDED_PROVIDERS.map((provider) => provider.slug);

    expect(slugs).toEqual(['openai', 'openrouter', 'anthropic', 'aws-bedrock', 'aws-bedrock-mantle', 'aws-polly', 'google-vertex', 'azure-ai-foundry', 'xai']);
    expect(slugs.every((slug) => PROVIDER_SLUGS.includes(slug))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_PROVIDERS.map((provider) => provider.key)).size).toBe(SEEDED_PROVIDERS.length);
  });

  test('match the persisted provider schema and handler slug', () => {
    for (const seed of SEEDED_PROVIDERS) {
      const parsed = providerSchema.parse(seed);

      expect(parsed.handlerKey).toBe(parsed.slug);
      expect(parsed.embedding).toEqual([]);
    }
  });
});

describe('model and routing relation seeds', () => {
  test('seed model components through their service providers', () => {
    expect(SEEDED_MODELS.map(({ slug }) => slug)).toEqual([
      'openai.gpt-5.6-sol',
      'openai.gpt-5.6-terra',
      'openai.gpt-5.6-luna',
      'amazon.nova-premier',
      'amazon.nova-pro',
      'openai.gpt-realtime-2',
      'amazon.polly-generative',
      'openai.text-embedding-3-small',
      'google.gemini-2.5-flash-lite',
    ]);
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'orchestrator-chat').map(({ modelSlug }) => modelSlug))
      .toEqual(['google.gemini-2.5-flash-lite', 'amazon.nova-pro']);
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'enhance').map(({ modelSlug }) => modelSlug))
      .toEqual(['google.gemini-2.5-flash-lite']);
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'translate').map(({ modelSlug }) => modelSlug))
      .toEqual(['google.gemini-2.5-flash-lite']);
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'embed')?.modelSlug).toBe('openai.text-embedding-3-small');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'generate-speech')?.modelSlug).toBe('amazon.polly-generative');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'caption-image')?.modelSlug).toBe('google.gemini-2.5-flash-lite');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'document-cleanup')?.modelSlug).toBe('google.gemini-2.5-flash-lite');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'describe-visual-identity')?.modelSlug).toBe('google.gemini-2.5-flash-lite');
    expect(SEEDED_MODEL_PROVIDERS.map(({ modelSlug, providerSlug, providerModelId, enabled }) => `${modelSlug}:${providerSlug}:${providerModelId}:${enabled}`)).toEqual([
      'openai.gpt-5.6-sol:aws-bedrock-mantle:openai.gpt-5.6-sol:false',
      'openai.gpt-5.6-terra:aws-bedrock-mantle:openai.gpt-5.6-terra:false',
      'openai.gpt-5.6-luna:aws-bedrock-mantle:openai.gpt-5.6-luna:false',
      'amazon.nova-premier:aws-bedrock:us.amazon.nova-premier-v1:0:false',
      'amazon.nova-pro:aws-bedrock:us.amazon.nova-pro-v1:0:true',
      'openai.gpt-realtime-2:openai:gpt-realtime-2:true',
      'openai.text-embedding-3-small:openrouter:openai/text-embedding-3-small:true',
      'amazon.polly-generative:aws-polly:generative:true',
      'google.gemini-2.5-flash-lite:openrouter:google/gemini-2.5-flash-lite:true',
    ]);
    expect(SEEDED_MODEL_PROVIDERS.filter((route) => route.modelSlug.includes('embedding')).map((route) => route.modelSlug)).toEqual(['openai.text-embedding-3-small']);
  });

  test('joins every action binding to its declared provider route', () => {
    for (const definition of ACTION_DEFINITIONS) {
      const seededBindings = SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === definition.id);
      expect(seededBindings.map(({ modelSlug, priority }) => ({ model: modelSlug, priority })), definition.id)
        .toEqual(definition.models.map(({ model, priority }) => ({ model, priority })));
      for (const binding of definition.models) {
        expect(SEEDED_MODEL_PROVIDERS.find((route) => route.modelSlug === binding.model && route.providerSlug === binding.provider), `${definition.id} -> ${binding.model} -> ${binding.provider}`).toBeDefined();
      }
    }
  });

  test('pins the complete Archive provider chain', () => {
    const archiveRoutes = [
      ['ask', 'google.gemini-2.5-flash-lite', 'openrouter', 'google/gemini-2.5-flash-lite'],
      ['enhance', 'google.gemini-2.5-flash-lite', 'openrouter', 'google/gemini-2.5-flash-lite'],
      ['translate', 'google.gemini-2.5-flash-lite', 'openrouter', 'google/gemini-2.5-flash-lite'],
      ['reason', 'amazon.nova-pro', 'aws-bedrock', 'us.amazon.nova-pro-v1:0'],
      ['deep-reason', 'amazon.nova-pro', 'aws-bedrock', 'us.amazon.nova-pro-v1:0'],
      ['speak', 'openai.gpt-realtime-2', 'openai', 'gpt-realtime-2'],
      ['embed', EMBEDDING_MODEL, 'openrouter', EXTERNAL_EMBEDDING_MODEL_ID],
    ] as const;
    for (const [actionSlug, modelSlug, providerSlug, providerModelId] of archiveRoutes) {
      expect(SEEDED_MODEL_ACTIONS.find((binding) => binding.actionSlug === actionSlug && binding.modelSlug === modelSlug), `${actionSlug} action binding`).toBeDefined();
      expect(SEEDED_MODEL_PROVIDERS.find((route) => route.modelSlug === modelSlug && route.providerSlug === providerSlug && route.providerModelId === providerModelId && route.enabled), `${actionSlug} provider route`).toBeDefined();
    }
  });
});

describe('voice seeds', () => {
  test('seed OpenAI GPT Realtime 2 US-English voices', () => {
    expect(SEEDED_VOICES).toHaveLength(3);
    expect(SEEDED_VOICES).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-realtime-2', voice: 'marin', label: 'Marin', language: 'en-US', format: 'mp3' }),
      expect.objectContaining({ provider: 'openai', model: 'gpt-realtime-2', voice: 'cedar', label: 'Cedar', language: 'en-US', format: 'mp3' }),
      expect.objectContaining({ provider: 'openai', model: 'gpt-realtime-2', voice: 'ash', label: 'Ash', language: 'en-US', format: 'mp3' }),
    ]);
    for (const seed of SEEDED_VOICES) {
      expect(voiceSchema.parse({ key: 'cmrnlzf640000qc7k4p5zem5w', ...seed, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }).embedding).toEqual([]);
    }
  });
});

describe('orchestrator seeds', () => {
  test('seed exactly the 20 executive orchestrator sources with their assigned OpenAI voices', () => {
    expect(SEEDED_ORCHESTRATOR_SOURCES).toHaveLength(20);
    expect(SEEDED_ORCHESTRATOR_SOURCES.map(({ name }) => name)).toEqual([...CANONICAL_ORCHESTRATOR_NAMES]);
    expect(SEEDED_ORCHESTRATOR_SOURCES.map(({ name, role }) => `${name}:${role}`)).toEqual([
      'Atlas:CEO', 'Metis:CIO', 'Echo:CKO', 'Matrix:CDO', 'Hermes:COO',
      'Harmony:CHRO', 'Phoenix:CGO', 'Iris:CCO', 'Orbit:CMO', 'Apollo:CSO',
      'Athena:CPO', 'Forge:CTO', 'Aura:CXO', 'Pillar:CQO', 'Helios:CAIO',
      'Vulcan:CAO', 'Ledger:CFO', 'Mercury:CRO', 'Sentinel:CISO', 'Themis:CLO',
    ]);
    expect(Object.fromEntries(SEEDED_ORCHESTRATOR_SOURCES.map(({ name, voice }) => [name, voice]))).toEqual({
      Atlas: 'cedar', Metis: 'cedar', Echo: 'cedar', Matrix: 'cedar', Hermes: 'cedar', Harmony: 'marin',
      Phoenix: 'cedar', Iris: 'marin', Orbit: 'marin', Apollo: 'cedar', Athena: 'marin', Forge: 'cedar',
      Aura: 'marin', Pillar: 'cedar', Helios: 'cedar', Vulcan: 'cedar', Ledger: 'cedar', Mercury: 'cedar',
      Sentinel: 'cedar', Themis: 'marin',
    });
  });

  test('embed nonempty skills whose frontmatter matches the source manifest', () => {
    for (const source of SEEDED_ORCHESTRATOR_SOURCES) {
      expect(source.skill.trim()).not.toBe('');
      expect(source.skill).toMatch(new RegExp(`^---\\nname: ${source.name}\\nrole: ${source.role}\\n`, 'm'));
    }
  });

  test('uses embedded skill snapshots at runtime', async () => {
    const seedSource = await Bun.file(join(import.meta.dir, 'seed.ts')).text();
    expect(seedSource).toContain('SEEDED_ORCHESTRATOR_SKILLS');
  });

  test('reconciles every orchestrator into the general communication channel', async () => {
    const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
    expect(source).toContain('UPSERT { channelKey: @channelKey, orchestratorKey: @orchestratorKey }');
    expect(source).toContain("collection: 'channelParticipants'");
  });
});

describe('AI runtime seed orchestration', () => {
  test('is idempotent across every v1 seed collection', async () => {
    const persisted = new Set<string>();
    const upsert = (collection: string) => async (seed: { key: string }): Promise<SeedResult> => {
      const identity = `${collection}:${seed.key}`;
      const status = persisted.has(identity) ? 'updated' : 'created';
      persisted.add(identity);
      return { collection, key: seed.key, status };
    };
    const upserters: AiRuntimeSeedUpserters = {
      provider: upsert('providers'),
      model: upsert('models'),
      reconcileObsoleteModelActions: async () => [],
      modelAction: upsert('modelActions'),
      modelProvider: upsert('modelProviders'),
    };

    const first = await seedAiRuntimeNodes(upserters);
    const second = await seedAiRuntimeNodes(upserters);
    expect(first.every((result) => result.status === 'created')).toBe(true);
    expect(second.every((result) => result.status === 'updated')).toBe(true);
    expect(second.map(({ collection, key }) => `${collection}:${key}`))
      .toEqual(first.map(({ collection, key }) => `${collection}:${key}`));
    expect(persisted.size).toBe(first.length);
  });

  test('retires Realtime orchestrator chat while preserving unrelated bindings', async () => {
    const routes = new Map([
      ['sonic-key:orchestrator-chat', { key: 'stale-binding-key', priority: 100, enabled: true }],
      ['nova-pro-key:orchestrator-chat', { key: 'nova-pro-chat-key', priority: 100, enabled: true }],
      ['gemini-key:orchestrator-chat', { key: 'gemini-chat-key', priority: 90, enabled: true }],
      ['sonic-key:speak', { key: 'sonic-speak-key', priority: 100, enabled: true }],
      ['custom-key:orchestrator-chat', { key: 'custom-chat-key', priority: 80, enabled: true }],
    ]);
    const modelKeys = new Map([['openai.gpt-realtime-2', 'sonic-key'], ['openai.gpt-5.6-terra', 'terra-key'], ['openai.gpt-5.6-luna', 'luna-key'], ['amazon.nova-pro', 'nova-pro-key'], ['google.gemini-2.5-flash-lite', 'gemini-key'], ['custom.model', 'custom-key']]);
    let reconciliationUpdates = 0;
    const noop = (collection: string) => async (seed: { key: string }): Promise<SeedResult> => ({ collection, key: seed.key, status: 'updated' });
    const upserters: AiRuntimeSeedUpserters = {
      provider: noop('providers'),
      model: noop('models'),
      reconcileObsoleteModelActions: () => reconcileObsoleteSeededModelActions({
        getModelBySlug: async (slug) => modelKeys.has(slug) ? { key: modelKeys.get(slug)! } : null,
        updateModel: async () => ({ collection: 'models', key: 'updated-model', status: 'updated' }),
        getModelActionByPair: async (modelKey, actionSlug) => routes.get(`${modelKey}:${actionSlug}`) ?? null,
        updateModelAction: async (key, patch) => {
          const route = [...routes.values()].find((candidate) => candidate.key === key)!;
          route.enabled = patch.enabled;
          reconciliationUpdates++;
        },
      }),
      modelAction: async (seed) => {
        const modelKey = modelKeys.get(seed.modelSlug) ?? seed.modelSlug;
        routes.set(`${modelKey}:${seed.actionSlug}`, { key: seed.key, priority: seed.priority, enabled: seed.enabled });
        return { collection: 'modelActions', key: seed.key, status: 'updated' };
      },
      modelProvider: noop('modelProviders'),
    };

    await seedAiRuntimeNodes(upserters);
    await seedAiRuntimeNodes(upserters);

    expect(routes.get('sonic-key:orchestrator-chat')?.enabled).toBe(false);
    expect(routes.get('nova-pro-key:orchestrator-chat')?.enabled).toBe(true);
    expect(routes.get('gemini-key:orchestrator-chat')?.enabled).toBe(true);
    expect(routes.get('sonic-key:speak')?.enabled).toBe(true);
    expect(routes.get('custom-key:orchestrator-chat')?.enabled).toBe(true);
    expect(reconciliationUpdates).toBe(1);
  });

  test('disables blocked GPT-5.6 models and their seeded routes during migration', async () => {
    const models = new Map([['openai.gpt-5.6-terra', { key: 'blocked-terra', enabled: true }]]);
    const routes = new Map([['blocked-terra:chat', { key: 'blocked-route', enabled: true }]]);

    const results = await reconcileObsoleteSeededModelActions({
      getModelBySlug: async (slug) => models.get(slug) ?? null,
      updateModel: async (key, patch) => {
        const model = [...models.values()].find((candidate) => candidate.key === key)!;
        model.enabled = patch.enabled;
      },
      getModelActionByPair: async (modelKey, actionSlug) => routes.get(`${modelKey}:${actionSlug}`) ?? null,
      updateModelAction: async (key, patch) => {
        const route = [...routes.values()].find((candidate) => candidate.key === key)!;
        route.enabled = patch.enabled;
      },
    });

    expect(models.get('openai.gpt-5.6-terra')?.enabled).toBe(false);
    expect(routes.get('blocked-terra:chat')?.enabled).toBe(false);
    expect(results.map(({ collection, key }) => `${collection}:${key}`)).toEqual(['models:blocked-terra', 'modelActions:blocked-route']);
  });

  test('retires the persisted Titan embedding model, action binding, and provider route', async () => {
    const model = { key: 'legacy-titan', enabled: true };
    const provider = { key: 'bedrock-provider' };
    const binding = { key: 'legacy-binding', enabled: true };
    const route = { key: 'legacy-route', enabled: true };

    const results = await reconcileObsoleteSeededModelActions({
      getModelBySlug: async (slug) => slug === 'amazon.titan-embed-text-v2' ? model : null,
      updateModel: async (_key, patch) => { model.enabled = patch.enabled; },
      getModelActionByPair: async () => binding,
      updateModelAction: async (_key, patch) => { binding.enabled = patch.enabled; },
      getProviderBySlug: async (slug) => slug === 'aws-bedrock' ? provider : null,
      getModelProviderByPair: async () => route,
      updateModelProvider: async (_key, patch) => { route.enabled = patch.enabled; },
    });

    expect({ model: model.enabled, binding: binding.enabled, route: route.enabled }).toEqual({ model: false, binding: false, route: false });
    expect(results.map(({ collection, key }) => `${collection}:${key}`)).toEqual([
      'models:legacy-titan',
      'modelActions:legacy-binding',
      'modelProviders:legacy-route',
    ]);
  });

  test('retires the persisted Qwen vision model, bindings, and OpenRouter route', async () => {
    const model = { key: 'legacy-qwen-vision', enabled: true };
    const actionSlugs = ['caption-image', 'document-cleanup', 'describe-visual-identity'];
    const bindings = new Map(actionSlugs.map((slug) => [`${model.key}:${slug}`, { key: `${slug}-binding`, enabled: true }]));
    const route = { key: 'legacy-qwen-route', enabled: true };

    const results = await reconcileObsoleteSeededModelActions({
      getModelBySlug: async (slug) => slug === 'qwen.qwen3-vl-32b-instruct' ? model : null,
      updateModel: async (_key, patch) => { model.enabled = patch.enabled; },
      getModelActionByPair: async (modelKey, actionSlug) => bindings.get(`${modelKey}:${actionSlug}`) ?? null,
      updateModelAction: async (key, patch) => { [...bindings.values()].find((binding) => binding.key === key)!.enabled = patch.enabled; },
      getProviderBySlug: async (slug) => slug === 'openrouter' ? { key: 'openrouter-provider' } : null,
      getModelProviderByPair: async () => route,
      updateModelProvider: async (_key, patch) => { route.enabled = patch.enabled; },
    });

    expect(model.enabled).toBe(false);
    expect([...bindings.values()].every(({ enabled }) => !enabled)).toBe(true);
    expect(route.enabled).toBe(false);
    expect(results.map(({ collection }) => collection)).toEqual(['models', 'modelActions', 'modelActions', 'modelActions', 'modelProviders']);
  });

  test('retires the persisted Nova Lite model, bindings, and Bedrock route', async () => {
    const model = { key: 'legacy-fast-model', enabled: true };
    const actionSlugs = ['ask', 'enhance', 'orchestrator-chat'];
    const bindings = new Map(actionSlugs.map((slug) => [`${model.key}:${slug}`, { key: `${slug}-binding`, enabled: true }]));
    const route = { key: 'legacy-fast-route', enabled: true };

    await reconcileObsoleteSeededModelActions({
      getModelBySlug: async (slug) => slug === 'amazon.nova-lite' ? model : null,
      updateModel: async (_key, patch) => { model.enabled = patch.enabled; },
      getModelActionByPair: async (modelKey, actionSlug) => bindings.get(`${modelKey}:${actionSlug}`) ?? null,
      updateModelAction: async (key, patch) => { [...bindings.values()].find((binding) => binding.key === key)!.enabled = patch.enabled; },
      getProviderBySlug: async (slug) => slug === 'aws-bedrock' ? { key: 'bedrock-provider' } : null,
      getModelProviderByPair: async () => route,
      updateModelProvider: async (_key, patch) => { route.enabled = patch.enabled; },
    });

    expect(model.enabled).toBe(false);
    expect([...bindings.values()].every(({ enabled }) => !enabled)).toBe(true);
    expect(route.enabled).toBe(false);
  });

  test('keeps the current model and action enabled while retiring all other embedding routes', async () => {
    const currentModel = { key: 'current-embedding', enabled: true };
    const retiredModel = { key: 'retired-embedding', enabled: true };
    const currentBinding = { key: 'current-binding', enabled: true };
    const retiredBinding = { key: 'retired-binding', enabled: true };
    const directRoute = { key: 'direct-openai-route', enabled: true };
    const retiredRoute = { key: 'retired-openrouter-route', enabled: true };
    const results = await reconcileObsoleteSeededModelActions({
      getModelBySlug: async (slug) => slug === 'openai.text-embedding-3-small' ? currentModel : null,
      getModelById: async (key) => key === retiredModel.key ? retiredModel : null,
      updateModel: async (key, patch) => { (key === currentModel.key ? currentModel : retiredModel).enabled = patch.enabled; },
      getModelActionByPair: async (modelKey) => modelKey === currentModel.key ? currentBinding : retiredBinding,
      listEnabledModelActionsByActionSlug: async () => [{ ...retiredBinding, modelKey: retiredModel.key }],
      updateModelAction: async (key, patch) => { (key === currentBinding.key ? currentBinding : retiredBinding).enabled = patch.enabled; },
      getProviderBySlug: async (slug) => ({ key: `${slug}-provider` }),
      getModelProviderByPair: async (modelKey, providerKey) => modelKey === currentModel.key && providerKey === 'openai-provider' ? directRoute : modelKey === retiredModel.key && providerKey === 'openrouter-provider' ? retiredRoute : null,
      updateModelProvider: async (key, patch) => { (key === directRoute.key ? directRoute : retiredRoute).enabled = patch.enabled; },
    });
    expect({ model: currentModel.enabled, binding: currentBinding.enabled, directRoute: directRoute.enabled }).toEqual({ model: true, binding: true, directRoute: false });
    expect({ model: retiredModel.enabled, binding: retiredBinding.enabled, route: retiredRoute.enabled }).toEqual({ model: false, binding: false, route: false });
    expect(results.map(({ collection, key }) => `${collection}:${key}`)).toEqual(['modelProviders:direct-openai-route', 'models:retired-embedding', 'modelActions:retired-binding', 'modelProviders:retired-openrouter-route']);
    expect(SEEDED_MODEL_ACTIONS.find((seed) => seed.actionSlug === 'embed')).toMatchObject({ modelSlug: 'openai.text-embedding-3-small', enabled: true });
  });
});
