import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { actionSchema } from './actions.node';
import { providerSchema } from './providers.node';
import { voiceSchema } from './voices.node';
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { join } from 'node:path';
import { NEXUS_SCOPE_KEY, SEEDED_ACTIONS, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_ORCHESTRATOR_SOURCES, SEEDED_PROVIDERS, SEEDED_SCOPES, SEEDED_VOICES, seedAiRuntimeNodes, type AiRuntimeSeedUpserters, type SeedResult } from './seed';

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
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === core.key).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['archive', 'gallery', 'signal', 'compass', 'ascend']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === command.key).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['atlas', 'hermes', 'metis', 'phoenix', 'apollo', 'iris', 'echo', 'matrix', 'harmony', 'ledger', 'orbit', 'mercury', 'sentinel', 'athena', 'forge', 'aura', 'pillar', 'helios', 'vulcan', 'themis']);
    expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === core.key || parentKey === command.key).every(({ level }) => level === 3)).toBe(true);
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'hq')).toMatchObject({ name: 'HQ', key: 'cmrnlzf640005qc7kefvra0bn' });
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'archive')).toMatchObject({ summary: 'Capture notes, ideas, research, labels, folders, semantic search, and knowledge graph connections.', description: 'Archive lets you capture, organize, semantically search, and connect your notes through folders, labels, backlinks, and graph traversal.' });
    expect(SEEDED_SCOPES.find(({ slug }) => slug === 'atlas')).toMatchObject({ summary: 'Vision, leadership, direction, executive strategy, and company wide decisions.', description: 'Vision, leadership, direction, executive strategy, and company wide decisions.' });
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

  test('does not seed domain workflows as actions', () => {
    expect(SEEDED_ACTIONS.some(({ slug }) => slug.includes('.'))).toBe(false);
    expect(SEEDED_ACTIONS.find(({ slug }) => slug === 'insert')).toMatchObject({ name: 'Insert', handlerKey: 'insert' });
  });
});

describe('provider seeds', () => {
  test('seed every supported provider while keeping its slug registered', () => {
    const slugs = SEEDED_PROVIDERS.map((provider) => provider.slug);

    expect(slugs).toEqual(['openai', 'openrouter', 'anthropic', 'aws-bedrock', 'aws-polly', 'aws-transcribe', 'google-vertex', 'azure-ai-foundry', 'xai']);
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
  test('seed the AWS model components through their service providers', () => {
    expect(SEEDED_MODELS.map(({ slug }) => slug)).toEqual([
      'amazon.nova-premier',
      'amazon.nova-pro',
      'amazon.nova-2-lite',
      'amazon.nova-2-sonic',
      'amazon.polly-generative',
      'amazon.titan-embed-text-v2',
      'aws.transcribe-standard',
    ]);
    expect(SEEDED_MODEL_ACTIONS.filter(({ actionSlug }) => actionSlug === 'orchestrator-chat').map(({ modelSlug }) => modelSlug))
      .toEqual(['amazon.nova-2-sonic']);
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'embed')?.modelSlug).toBe('amazon.titan-embed-text-v2');
    expect(SEEDED_MODEL_ACTIONS.find(({ actionSlug }) => actionSlug === 'generate-speech')?.modelSlug).toBe('amazon.polly-generative');
    expect(SEEDED_MODEL_PROVIDERS.map(({ modelSlug, providerSlug, providerModelId, enabled }) => `${modelSlug}:${providerSlug}:${providerModelId}:${enabled}`)).toEqual([
      'amazon.nova-premier:aws-bedrock:amazon.nova-premier-v1:0:true',
      'amazon.nova-pro:aws-bedrock:amazon.nova-pro-v1:0:true',
      'amazon.nova-2-lite:aws-bedrock:amazon.nova-2-lite-v1:0:true',
      'amazon.nova-2-sonic:aws-bedrock:amazon.nova-2-sonic-v1:0:true',
      'amazon.titan-embed-text-v2:aws-bedrock:amazon.titan-embed-text-v2:0:true',
      'amazon.polly-generative:aws-polly:generative:true',
      'aws.transcribe-standard:aws-transcribe:standard:true',
    ]);
  });
});

describe('voice seeds', () => {
  test('seed Amazon Nova 2 Sonic US-English voices', () => {
    expect(SEEDED_VOICES).toHaveLength(2);
    expect(SEEDED_VOICES).toEqual([
      expect.objectContaining({ provider: 'aws-bedrock', model: 'amazon.nova-2-sonic-v1:0', voice: 'Tiffany', label: 'Lyra', language: 'en-US', format: 'mp3' }),
      expect.objectContaining({ provider: 'aws-bedrock', model: 'amazon.nova-2-sonic-v1:0', voice: 'Matthew', label: 'Orion', language: 'en-US', format: 'mp3' }),
    ]);
    for (const seed of SEEDED_VOICES) {
      expect(voiceSchema.parse({ key: 'cmrnlzf640000qc7k4p5zem5w', ...seed, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }).embedding).toEqual([]);
    }
  });
});

describe('orchestrator seeds', () => {
  test('seed exactly the 20 executive orchestrator sources with their assigned Nova voices', () => {
    expect(SEEDED_ORCHESTRATOR_SOURCES).toHaveLength(20);
    expect(SEEDED_ORCHESTRATOR_SOURCES.map(({ name, role }) => `${name}:${role}`)).toEqual([
      'Atlas:CEO', 'Metis:CIO', 'Echo:CKO', 'Matrix:CDO', 'Hermes:COO',
      'Harmony:CHRO', 'Phoenix:CGO', 'Iris:CCO', 'Orbit:CMO', 'Apollo:CSO',
      'Athena:CPO', 'Forge:CTO', 'Aura:CXO', 'Pillar:CQO', 'Helios:CAIO',
      'Vulcan:CAO', 'Ledger:CFO', 'Mercury:CRO', 'Sentinel:CISO', 'Themis:CLO',
    ]);
    expect(Object.fromEntries(SEEDED_ORCHESTRATOR_SOURCES.map(({ name, voice }) => [name, voice]))).toEqual({
      Atlas: 'Matthew', Metis: 'Matthew', Echo: 'Matthew', Matrix: 'Matthew', Hermes: 'Matthew', Harmony: 'Tiffany',
      Phoenix: 'Matthew', Iris: 'Tiffany', Orbit: 'Tiffany', Apollo: 'Matthew', Athena: 'Tiffany', Forge: 'Matthew',
      Aura: 'Tiffany', Pillar: 'Matthew', Helios: 'Matthew', Vulcan: 'Matthew', Ledger: 'Matthew', Mercury: 'Matthew',
      Sentinel: 'Matthew', Themis: 'Tiffany',
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
