import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { actionSchema } from './actions.node';
import { providerSchema } from './providers.node';
import { modelSchema } from './models.node';
import { modelActionSeedSchema } from './model-actions.node';
import { modelProviderSeedSchema } from './model-providers.node';
import { toolSchema } from './tools.node';
import { toolActionSeedSchema } from './tool-actions.node';
import { TOOL_REGISTRY } from '@/lib/ai/tools';
import { SEEDED_ACTIONS, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_PROVIDERS, SEEDED_TOOLS, SEEDED_TOOL_ACTIONS, seedAiRuntimeNodes, type AiRuntimeSeedUpserters, type SeedResult } from './seed';

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
  });

  test('seed exactly one OpenAI route for each model', () => {
    const parsed = SEEDED_MODEL_PROVIDERS.map((seed) => modelProviderSeedSchema.parse(seed));

    expect(parsed.map(({ modelSlug, providerSlug, providerModelId }) => `${modelSlug}:${providerSlug}:${providerModelId}`).sort()).toEqual([
      'openai.gpt-5.4-mini:openai:gpt-5.4-mini',
      'openai.gpt-5.4-nano:openai:gpt-5.4-nano',
    ]);
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
      'artifact.read:artifact.read',
      'ask.answer:core.ask',
      'audio.transcribe-file:audio.transcribe',
      'image.create:image.generate',
      'reason.solve:core.reason',
      'speech.narrate:audio.generate-speech',
    ]);
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
