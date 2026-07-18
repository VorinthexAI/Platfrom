import { describe, expect, test } from 'bun:test';
import { artifactDefinitionSchema, type Artifact, type ArtifactDefinition, type ArtifactDependency, type ArtifactSnapshot } from './schema';
import { ArtifactAuthorizationError, ArtifactCycleError, createArtifactService } from './service';
import type { ArtifactRepository } from './repository';

function definition(overrides: Partial<ArtifactDefinition> = {}): ArtifactDefinition {
  return artifactDefinitionSchema.parse({
    version: 1,
    mode: 'live',
    renderer: 'dashboard',
    layout: { type: 'metric', title: 'MRR', binding: 'currentMrr' },
    bindings: { currentMrr: { kind: 'literal', value: 500_000, format: { type: 'currency', currency: 'SEK', compact: true } } },
    ...overrides,
  });
}

function memoryRepository(): ArtifactRepository & { artifacts: Map<string, Artifact>; snapshots: Map<string, ArtifactSnapshot>; dependencies: Map<string, ArtifactDependency[]> } {
  const artifacts = new Map<string, Artifact>();
  const snapshots = new Map<string, ArtifactSnapshot>();
  const dependencies = new Map<string, ArtifactDependency[]>();
  return {
    artifacts, snapshots, dependencies,
    async insertArtifact(artifact) { artifacts.set(artifact.key, artifact); return artifact; },
    async updateArtifact(key, patch) { const next = { ...artifacts.get(key)!, ...patch }; artifacts.set(key, next); return next; },
    async getArtifact(key) { return artifacts.get(key) ?? null; },
    async listArtifacts(organizationKey, scopeKey) { return [...artifacts.values()].filter((artifact) => artifact.organizationKey === organizationKey && artifact.scopeKey === scopeKey); },
    async deleteArtifact(key) { artifacts.delete(key); dependencies.delete(key); },
    async replaceDependencies(key, rows) { dependencies.set(key, rows); },
    async listDependencies(key) { return dependencies.get(key) ?? []; },
    async insertSnapshot(snapshot) { snapshots.set(snapshot.key, snapshot); return snapshot; },
    async getSnapshot(key) { return snapshots.get(key) ?? null; },
  };
}

const context = { organizationKey: 'root-org', scopeKey: 'cmrnlzf640000qc7k4p5zem5w' };

describe('artifact definition', () => {
  test('keeps layout aliases separate from graph references', () => {
    const parsed = artifactDefinitionSchema.parse({
      version: 1,
      mode: 'live',
      renderer: 'dashboard',
      layout: { type: 'metric', binding: 'currentMrr' },
      bindings: { currentMrr: { kind: 'node', ref: { type: 'revenueMetrics', key: 'metric_123' }, path: ['currentMrr'] } },
    });
    expect(parsed.layout.binding).toBe('currentMrr');
    expect(parsed.bindings.currentMrr).toEqual({ kind: 'node', ref: { type: 'revenueMetrics', key: 'metric_123' }, path: ['currentMrr'] });
  });

  test('rejects raw executable queries and unknown layout bindings', () => {
    expect(() => artifactDefinitionSchema.parse({
      version: 1, mode: 'live', renderer: 'table', layout: { type: 'table', binding: 'rows' },
      bindings: { rows: { kind: 'query', query: 'FOR x IN users RETURN x' } },
    })).toThrow();
    expect(() => artifactDefinitionSchema.parse({ version: 1, mode: 'live', renderer: 'dashboard', layout: { type: 'metric', binding: 'missing' }, bindings: {} })).toThrow('Unknown binding alias');
  });

  test('rejects prototype traversal paths', () => {
    expect(() => artifactDefinitionSchema.parse({
      version: 1, mode: 'live', renderer: 'document', layout: { type: 'text', binding: 'unsafe' },
      bindings: { unsafe: { kind: 'node', ref: { type: 'agents', key: 'cmrnlzf640000qc7k4p5zem5w' }, path: ['__proto__'] } },
    })).toThrow('Unsafe path segment');
  });

  test('rejects cycles between query binding variables', () => {
    expect(() => artifactDefinitionSchema.parse({
      version: 1, mode: 'live', renderer: 'table', layout: { type: 'table', binding: 'first' },
      bindings: {
        first: { kind: 'query', queryId: 'scope.active-agents', variables: { scopeKey: { kind: 'binding', binding: 'second' } } },
        second: { kind: 'query', queryId: 'scope.active-agents', variables: { scopeKey: { kind: 'binding', binding: 'first' } } },
      },
    })).toThrow('Binding cycle');
  });
});

describe('artifact service', () => {
  test('stores normalized dependencies and freezes snapshot values', async () => {
    const repository = memoryRepository();
    const service = createArtifactService(repository);
    const artifact = await service.create({ ...context, name: 'Executive view', definition: definition({ mode: 'snapshot' }), createdByUserOrganizationKey: 'member_1' });
    expect(artifact.snapshotKey).not.toBeNull();
    expect(repository.dependencies.get(artifact.key)?.map((row) => row.dependencyType)).toEqual(['scope', 'organization']);
    const resolved = await service.resolve(artifact.key, context);
    expect(resolved.resolved.currentMrr).toBe(500_000);
    expect(resolved.revisions.currentMrr).toBe('literal');
  });

  test('prevents artifact reference cycles on update', async () => {
    const repository = memoryRepository();
    const service = createArtifactService(repository);
    const first = await service.create({ ...context, name: 'First', definition: definition() });
    const second = await service.create({ ...context, name: 'Second', definition: definition({
      layout: { type: 'artifact', binding: 'first' },
      bindings: { first: { kind: 'artifact', artifactKey: first.key } },
    }) });
    await expect(service.update(first.key, {
      name: 'First',
      definition: definition({ layout: { type: 'artifact', binding: 'second' }, bindings: { second: { kind: 'artifact', artifactKey: second.key } } }),
    }, context)).rejects.toBeInstanceOf(ArtifactCycleError);
  });

  test('prevents references across scope authorization boundaries', async () => {
    const repository = memoryRepository();
    const service = createArtifactService(repository);
    const first = await service.create({ ...context, name: 'Private scope view', definition: definition() });
    await expect(service.create({
      organizationKey: context.organizationKey,
      scopeKey: 'clwop4v5k000008l5e0p5abcd',
      name: 'Foreign reference',
      definition: definition({ layout: { type: 'artifact', binding: 'foreign' }, bindings: { foreign: { kind: 'artifact', artifactKey: first.key } } }),
    })).rejects.toBeInstanceOf(ArtifactAuthorizationError);
  });
});
