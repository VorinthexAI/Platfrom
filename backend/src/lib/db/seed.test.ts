import { describe, expect, test } from 'bun:test';

test('country seeds embed only missing or stale semantic content', async () => {
  const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
  expect(source).toContain('current?.semanticVersion === 1 && current.semanticHash === semanticHash');
  expect(source).toContain("createHash('sha256').update(country.name)");
  expect(source.indexOf('if (current?.semanticVersion')).toBeLessThan(source.indexOf('embedText({ text: country.name })'));
});

test('runtime seeds avoid re-embedding unchanged semantic records', async () => {
  const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
  expect(source.indexOf('isDeepStrictEqual(existing.metadata, seed.metadata)')).toBeLessThan(source.indexOf("updateSemanticSeed('organizations', existing.key"));
  expect(source.indexOf('isDeepStrictEqual(existing.skill, seed.skill)')).toBeLessThan(source.indexOf("updateSemanticSeed('orchestrators', existing.key"));
});

test('runtime seeds defer only retryable refreshes of existing semantic records', async () => {
  const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
  expect(source).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
  expect(source).toContain("updateSemanticSeed('organizations', existing.key");
  expect(source).toContain("updateSemanticSeed('orchestrators', existing.key");
  expect(source).toContain('semantic seed refresh for ${country.countryCode} deferred');
});

test('seed command defers only normalized retryable provider outages', async () => {
  const source = await Bun.file(new URL('./seed.ts', import.meta.url)).text();
  const command = source.slice(source.indexOf('if (import.meta.main)'));
  expect(command).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
  expect(command).toContain('Database seed deferred because');
  expect(command).toContain('await closeDb()');
});
import { scopeSchema, scopeScopeSchema } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { join } from 'node:path';
import { NEXUS_SCOPE_KEY, SEEDED_ORCHESTRATOR_SOURCES, SEEDED_SCOPES } from './seed';
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
