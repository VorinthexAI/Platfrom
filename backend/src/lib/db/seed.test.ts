import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { actionSchema } from './actions.node';
import { providerSchema } from './providers.node';
import { toolSchema } from './tools.node';
import { toolActionSeedSchema } from './tool-actions.node';
import { TOOL_REGISTRY } from '@/lib/ai/tools';
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { NEXUS_SCOPE_KEY, SEEDED_ACTIONS, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_PROVIDERS, SEEDED_SCOPES, SEEDED_TOOLS, SEEDED_TOOL_ACTIONS, seedAiRuntimeNodes, type AiRuntimeSeedUpserters, type SeedResult } from './seed';

describe('scope seeds', () => {
  test('place the seven product scopes as siblings directly below Nexus', () => {
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === null).map(({ slug }) => slug)).toEqual(['nexus']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual([
      'core',
      'launch',
      'studio',
      'head-quarters',
      'replica',
      'pilot',
      'command',
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
    expect(Object.fromEntries(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).map(({ slug, position }) => [slug, position]))).toEqual({ core: 1, launch: 2, studio: 3, command: 7, 'head-quarters': 4, replica: 5, pilot: 6 });
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === NEXUS_SCOPE_KEY).every(({ level }) => level === 2)).toBe(true);
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
  test('seed every supported provider while keeping its slug registered', () => {
    const slugs = SEEDED_PROVIDERS.map((provider) => provider.slug);

    expect(slugs).toEqual(['openai', 'openrouter', 'anthropic', 'aws-bedrock', 'google-vertex', 'azure-ai-foundry', 'xai']);
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
  test('does not seed models or routing relations', () => {
    expect(SEEDED_MODELS).toEqual([]);
    expect(SEEDED_MODEL_ACTIONS).toEqual([]);
    expect(SEEDED_MODEL_PROVIDERS).toEqual([]);
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
