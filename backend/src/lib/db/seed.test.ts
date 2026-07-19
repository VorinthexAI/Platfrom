import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { actionSchema } from './actions.node';
import { providerSchema } from './providers.node';
import { modelSchema } from './models.node';
import { modelActionSeedSchema } from './model-actions.node';
import { modelProviderSchema, modelProviderSeedSchema } from './model-providers.node';
import { toolSchema } from './tools.node';
import { toolActionSeedSchema } from './tool-actions.node';
import { TOOL_REGISTRY } from '@/lib/ai/tools';
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { NEXUS_SCOPE_KEY, SEEDED_ACTIONS, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_PROVIDERS, SEEDED_SCOPES, SEEDED_TOOLS, SEEDED_TOOL_ACTIONS, reconcileRootOpenAiRouting, seedAiRuntimeNodes, type AiRuntimeSeedUpserters, type RootOpenAiRoutingDataSource, type SeedResult } from './seed';

describe('scope seeds', () => {
  test('place the seven product scopes as siblings directly below Nexus', () => {
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === null).map(({ slug }) => slug)).toEqual(['nexus']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).map(({ slug }) => slug)).toEqual([
      'core',
      'launch',
      'studio',
      'command',
      'head-quarters',
      'replica',
      'pilot',
    ]);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.key).toBe(NEXUS_SCOPE_KEY);
    expect(new Set(SEEDED_SCOPES.map(({ key }) => key)).size).toBe(SEEDED_SCOPES.length);
    const seededKeys = new Set(SEEDED_SCOPES.map(({ key }) => key));
    for (const scope of SEEDED_SCOPES) {
      scopeSchema.parse({ ...scope, organizationKey: newId() });
      if (scope.parentKey) {
        expect(seededKeys.has(scope.parentKey)).toBe(true);
        scopeScopeSchema.parse({ key: newId(), parentKey: scope.parentKey, childKey: scope.key });
      }
    }
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.position).toBe(1);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'nexus')?.summary).toBe('Vorinthex is an AI native platform that unifies intelligence, knowledge and execution into a single system that helps people and organizations think, build and achieve more with artificial intelligence.');
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).every(({ position }) => position === 2)).toBe(true);
    expect(Object.fromEntries(SEEDED_SCOPES.filter(({ slug }) => slug !== 'nexus').map(({ slug, description }) => [slug, description]))).toEqual({
      core: 'Your personal AI brain for memory, knowledge, reasoning, and everyday productivity across work and life.',
      launch: 'Build, automate, deploy, and manage intelligent workflows, agents, and business processes from one unified workspace.',
      studio: 'Create websites, apps, documents, images, videos, music, and code with AI powered creative and development tools.',
      command: 'Manage AI executive teams and orchestrators that help lead strategy, operations, growth, finance, technology, and security.',
      'head-quarters': 'Collaborate across teams, projects, files, calendars, meetings, and communication in one centralized workspace.',
      replica: 'Explore interactive demonstrations of every Vorinthex capability using realistic sample data before deploying your own.',
      pilot: 'Your conversational AI assistant that helps you navigate, operate, and get the most out of the entire Vorinthex platform.',
    });
  });
});

describe('action seeds', () => {
  test('seed every registered action exactly once', () => {
    const slugs = SEEDED_ACTIONS.map((action) => action.slug);

    expect([...slugs].sort()).toEqual([...ACTION_SLUGS].sort());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_ACTIONS.map((action) => action.key)).size).toBe(SEEDED_ACTIONS.length);
  });

  test('match the persisted action schema and handler slug', () => {
    for (const seed of SEEDED_ACTIONS) {
      const parsed = actionSchema.parse(seed);

      expect(parsed.handlerKey).toBe(parsed.slug);
      expect(parsed.embedding).toEqual([]);
    }
  });

  test('seed agent.create as a local architecture action with all embedding source fields', () => {
    expect(SEEDED_ACTIONS.find(({ slug }) => slug === 'agent.create')).toEqual({
      key: 'cmgenesisactioncreateagent001', slug: 'agent.create', name: 'Create Agent',
      description: 'Validates and transactionally creates or reuses an agent, its required skills, skill relations, and allowed tool relations.',
      objective: 'Persist a complete validated agent architecture from a Genesis creation manifest.',
      inputDescription: 'A validated Genesis agent creation manifest containing an agent operation, skill operations, agent skill relations, and existing tools to attach.',
      outputDescription: 'The persisted or reused agent, created skills, linking nodes, provenance artifacts, and validation result.',
      handlerKey: 'agent.create', enabled: true,
    });
  });
});

describe('provider seeds', () => {
  test('seed only OpenAI while keeping its slug registered', () => {
    const slugs = SEEDED_PROVIDERS.map((provider) => provider.slug);

    expect(slugs).toEqual(['openai']);
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
  test('seed every runtime model exactly once', () => {
    const slugs = SEEDED_MODELS.map((model) => model.slug);

    expect([...slugs].sort()).toEqual([...MODEL_SLUGS].sort());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_MODELS.map((model) => model.key)).size).toBe(SEEDED_MODELS.length);

    for (const seed of SEEDED_MODELS) {
      expect(modelSchema.parse(seed).embedding).toEqual([]);
    }
  });

  test('seed exactly the requested model-action links', () => {
    const parsed = SEEDED_MODEL_ACTIONS.map((seed) => modelActionSeedSchema.parse(seed));

    expect(parsed.map(({ modelSlug, actionSlug }) => `${modelSlug}:${actionSlug}`).sort()).toEqual([
      'openai.gpt-5.4-mini:core.reason',
      'openai.gpt-5.4-nano:core.ask',
    ]);
    expect(parsed.some(({ actionSlug }) => actionSlug.startsWith('scope.') || actionSlug.startsWith('organization.member.'))).toBe(false);
    expect(parsed.some(({ actionSlug }) => actionSlug === 'core.delegate')).toBe(false);
  });

  test('seed exactly one OpenAI route for each model', () => {
    const parsed = SEEDED_MODEL_PROVIDERS.map((seed) => modelProviderSeedSchema.parse(seed));

    expect(parsed.map(({ modelSlug, providerSlug, providerModelId }) => `${modelSlug}:${providerSlug}:${providerModelId}`).sort()).toEqual([
      'openai.gpt-5.4-mini:openai:gpt-5.4-mini',
      'openai.gpt-5.4-nano:openai:gpt-5.4-nano',
    ]);
  });

  test('reconciles the root organization to only current models routed through OpenAI', async () => {
    const rootOrganizationKey = 'vorinthex-root';
    const openAiProviderKey = SEEDED_PROVIDERS[0].key;
    const legacyProviderKey = newId();
    const models = [
      ...SEEDED_MODELS.map((seed) => modelSchema.parse(seed)),
      modelSchema.parse({
        key: newId(), slug: 'legacy.old-model', name: 'Old Model', description: 'Legacy model.',
        supportedUseCases: 'Historical workloads.', enabled: true,
      }),
    ];
    const modelProviders = [
      ...SEEDED_MODEL_PROVIDERS.map((seed) => {
        const model = models.find(({ slug }) => slug === seed.modelSlug)!;
        return modelProviderSchema.parse({ ...seed, modelKey: model.key, providerKey: openAiProviderKey });
      }),
      modelProviderSchema.parse({
        key: newId(), modelKey: models[0]!.key, providerKey: legacyProviderKey,
        providerModelId: 'legacy-mini', enabled: true,
      }),
    ];
    const organizationProviderKeys = [legacyProviderKey];
    const source: RootOpenAiRoutingDataSource = {
      async listOrganizationProviderKeys() { return organizationProviderKeys; },
      async addOrganizationProvider(_organizationKey, providerKey) { organizationProviderKeys.push(providerKey); },
      async removeOrganizationProvider(_organizationKey, providerKey) { organizationProviderKeys.splice(organizationProviderKeys.indexOf(providerKey), 1); },
      async listModels() { return models; },
      async updateModel(key, patch) { Object.assign(models.find((model) => model.key === key)!, patch); },
      async listModelProviders() { return modelProviders; },
      async deleteModelProvider(key) { modelProviders.splice(modelProviders.findIndex((route) => route.key === key), 1); },
    };

    expect(await reconcileRootOpenAiRouting(rootOrganizationKey, openAiProviderKey, source)).toEqual({
      addedOpenAiProvider: true,
      removedOrganizationProviders: 1,
      disabledStaleModels: 1,
      removedNonOpenAiModelRoutes: 1,
      verifiedCurrentModels: 2,
    });
    expect(organizationProviderKeys).toEqual([openAiProviderKey]);
    expect(models.find(({ slug }) => slug === 'legacy.old-model')?.enabled).toBe(false);
    expect(modelProviders.every(({ providerKey }) => providerKey === openAiProviderKey)).toBe(true);

    expect(await reconcileRootOpenAiRouting(rootOrganizationKey, openAiProviderKey, source)).toEqual({
      addedOpenAiProvider: false,
      removedOrganizationProviders: 0,
      disabledStaleModels: 0,
      removedNonOpenAiModelRoutes: 0,
      verifiedCurrentModels: 2,
    });
  });
});

describe('tool and tool-action seeds', () => {
  test('mirror every runtime tool as a reusable persisted tool', () => {
    expect(SEEDED_TOOLS.map((tool) => String(tool.slug)).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
    expect(new Set(SEEDED_TOOLS.map((tool) => tool.key)).size).toBe(SEEDED_TOOLS.length);

    for (const seed of SEEDED_TOOLS) {
      const parsed = toolSchema.parse(seed);
      const runtime = TOOL_REGISTRY[parsed.slug];
      expect(parsed.name).toBe(runtime.name);
      expect(parsed.description).toBe(runtime.description);
      expect(parsed.scopeKey).toBe(runtime.scopeId);
    }
  });

  test('move every runtime action reference into toolActions', () => {
    const parsed = SEEDED_TOOL_ACTIONS.map((seed) => toolActionSeedSchema.parse(seed));
    expect(new Set(parsed.map((relation) => relation.key)).size).toBe(parsed.length);
    expect(parsed.map(({ toolSlug, actionSlug }) => `${toolSlug}:${actionSlug}`).sort()).toEqual([
      'agent.create:agent.create',
      'artifact.create:artifact.create',
      'artifact.read:artifact.read',
      'ask.answer:core.ask',
      'audio.transcribe-file:audio.transcribe',
      'core.delegate:core.delegate',
      'image.create:image.generate',
      'organization.member.activate:organization.member.activate',
      'organization.member.add:organization.member.add',
      'organization.member.list:organization.member.list',
      'organization.member.read:organization.member.read',
      'organization.member.remove:organization.member.remove',
      'organization.member.role.update:organization.member.role.update',
      'organization.member.suspend:organization.member.suspend',
      'reason.solve:core.reason',
      'scope.archive:scope.archive',
      'scope.create:scope.create',
      'scope.list:scope.list',
      'scope.move:scope.move',
      'scope.read:scope.read',
      'scope.remove:scope.remove',
      'scope.restore:scope.restore',
      'scope.update:scope.update',
      'speech.narrate:audio.generate-speech',
      ...ACTION_SLUGS.filter((slug) => slug.startsWith('scope.member.') || slug.startsWith('scope.agent.') || slug.startsWith('agent.member.') || slug.startsWith('organization.provider.') || /^organization\.(read|update|archive|restore)$/.test(slug) || slug.startsWith('access.')).map((slug) => `${slug}:${slug}`),
    ].sort());
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
      action: upsert('actions'),
      provider: upsert('providers'),
      model: upsert('models'),
      modelAction: upsert('modelActions'),
      modelProvider: upsert('modelProviders'),
      tool: upsert('tools'),
      toolAction: upsert('toolActions'),
    };

    const first = await seedAiRuntimeNodes(upserters);
    const second = await seedAiRuntimeNodes(upserters);
    expect(first.every((result) => result.status === 'created')).toBe(true);
    expect(second.every((result) => result.status === 'updated')).toBe(true);
    expect(second.map(({ collection, key }) => `${collection}:${key}`))
      .toEqual(first.map(({ collection, key }) => `${collection}:${key}`));
    expect(persisted.size).toBe(first.length);
  });
});
