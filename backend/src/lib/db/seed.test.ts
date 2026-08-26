import { describe, expect, test } from 'bun:test';

test('country seeds embed only missing or stale semantic content', async () => {
  const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
  expect(source).toContain('current?.semanticVersion === 1 && current.semanticHash === semanticHash');
  expect(source).toContain("createHash('sha256').update(country.name)");
  expect(source.indexOf('if (current?.semanticVersion')).toBeLessThan(source.indexOf('embedText({ text: country.name })'));
});
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';
import { providerSchema } from './providers.node';
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { join } from 'node:path';
import { NEXUS_SCOPE_KEY, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_ORCHESTRATOR_SOURCES, SEEDED_PROVIDERS, SEEDED_SCOPES, seedAiRuntimeNodes, seededModelActionKey, type AiRuntimeSeedUpserters, type SeedResult } from './seed';
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
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'compass')).toMatchObject({ summary: expect.stringContaining('viewing available cities'), description: expect.stringContaining('available destination cities') });
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

    expect(slugs).toEqual(['openai', 'openrouter', 'anthropic', 'aws-bedrock', 'aws-bedrock-mantle', 'google-vertex', 'azure-ai-foundry', 'xai']);
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
    expect(SEEDED_MODELS).toHaveLength(7);
    expect(SEEDED_MODEL_PROVIDERS).toHaveLength(7);
    expect(SEEDED_MODELS.map(({ slug }) => slug)).toEqual([
      'openai.gpt-5.6-luna',
      'openai.gpt-image-2',
      'openai.gpt-4o-mini-tts',
      'openai.text-embedding-3-small',
      'bfl.flux-2-klein-4b',
      'xai.grok-imagine-image-quality',
      'google.gemini-2.5-flash-lite',
    ]);
    expect(new Set(SEEDED_MODEL_ACTIONS.map(({ modelSlug }) => modelSlug))).toEqual(new Set(SEEDED_MODELS.map(({ slug }) => slug)));
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'caption-image')?.modelSlug).toBe('openai.gpt-5.6-luna');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'generate-image')?.modelSlug).toBe('bfl.flux-2-klein-4b');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'embed')?.modelSlug).toBe('openai.text-embedding-3-small');
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'ask').map(({ actionSlug, modelSlug, priority }) => ({ actionSlug, modelSlug, priority }))).toEqual([
      { actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite', priority: 100 },
      { actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', priority: 90 },
    ]);
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'web-search').map(({ modelSlug, priority }) => ({ modelSlug, priority }))).toEqual([
      { modelSlug: 'google.gemini-2.5-flash-lite', priority: 100 }, { modelSlug: 'openai.gpt-5.6-luna', priority: 90 },
    ]);
    expect(new Set(SEEDED_MODEL_ACTIONS.map(({ key }) => key)).size).toBe(SEEDED_MODEL_ACTIONS.length);
    expect(SEEDED_MODEL_ACTIONS.every(({ key }) => /^c[a-f0-9]{24}$/.test(key))).toBe(true);
    expect(seededModelActionKey('ask', 'google.gemini-2.5-flash-lite')).toBe(seededModelActionKey('ask', 'google.gemini-2.5-flash-lite'));
    expect(seededModelActionKey('ask', 'google.gemini-2.5-flash-lite')).not.toBe(seededModelActionKey('web-search', 'google.gemini-2.5-flash-lite'));
    expect(SEEDED_MODEL_ACTIONS.map(({ key }) => key)).not.toContain('cmmodelaction00000000001');
    expect(SEEDED_MODEL_PROVIDERS.map(({ modelSlug, providerSlug, providerModelId, enabled }) => `${modelSlug}:${providerSlug}:${providerModelId}:${enabled}`)).toEqual([
      'openai.gpt-5.6-luna:openai:gpt-5.6-luna:true',
      'openai.gpt-image-2:openai:gpt-image-2:true',
      'openai.gpt-4o-mini-tts:openai:gpt-4o-mini-tts:true',
      'openai.text-embedding-3-small:openai:text-embedding-3-small:true',
      'bfl.flux-2-klein-4b:openrouter:black-forest-labs/flux.2-klein-4b:true',
      'xai.grok-imagine-image-quality:openrouter:x-ai/grok-imagine-image-quality:true',
      'google.gemini-2.5-flash-lite:openrouter:google/gemini-2.5-flash-lite:true',
    ]);
    for (const model of SEEDED_MODELS) expect(SEEDED_MODEL_PROVIDERS.find((route) => route.modelSlug === model.slug && route.enabled)).toBeDefined();
    for (const action of ACTION_DEFINITIONS) {
      for (const binding of action.models) {
        expect(SEEDED_MODELS.some(({ slug }) => slug === binding.model)).toBe(true);
        expect(SEEDED_MODEL_PROVIDERS.some(({ modelSlug, providerSlug, enabled }) => modelSlug === binding.model && providerSlug === binding.provider && enabled)).toBe(true);
        expect(SEEDED_MODEL_ACTIONS.some(({ actionSlug, modelSlug, enabled }) => actionSlug === action.id && modelSlug === binding.model && enabled)).toBe(true);
      }
    }
  });
});

describe('orchestrator seeds', () => {
  test('seed exactly the 20 executive orchestrator sources', () => {
    expect(SEEDED_ORCHESTRATOR_SOURCES).toHaveLength(20);
    expect(SEEDED_ORCHESTRATOR_SOURCES.map(({ name }) => name)).toEqual([...CANONICAL_ORCHESTRATOR_NAMES]);
    expect(SEEDED_ORCHESTRATOR_SOURCES.map(({ name, role }) => `${name}:${role}`)).toEqual([
      'Atlas:CEO', 'Metis:CIO', 'Echo:CKO', 'Matrix:CDO', 'Hermes:COO',
      'Harmony:CHRO', 'Phoenix:CGO', 'Iris:CCO', 'Orbit:CMO', 'Apollo:CSO',
      'Athena:CPO', 'Forge:CTO', 'Aura:CXO', 'Pillar:CQO', 'Helios:CAIO',
      'Vulcan:CAO', 'Ledger:CFO', 'Mercury:CRO', 'Sentinel:CISO', 'Themis:CLO',
    ]);
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

});
