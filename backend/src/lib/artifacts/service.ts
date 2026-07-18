import { newId } from '@/lib/ids';
import { artifactDefinitionSchema, artifactLiteralSchema, artifactSchema, type Artifact, type ArtifactBinding, type ArtifactDefinition, type ArtifactDependency, type ArtifactLiteral } from './schema';
import { getDefaultArtifactRepository, type ArtifactRepository } from './repository';
import { isRegisteredArtifactQuery, resolveArtifactNode, resolveArtifactQuery, type ArtifactResolveContext } from './registry';

export class ArtifactNotFoundError extends Error {}
export class ArtifactAuthorizationError extends Error {}
export class ArtifactCycleError extends Error {}

export interface ResolvedArtifact {
  artifact: Artifact;
  resolved: Record<string, ArtifactLiteral>;
  revisions: Record<string, string>;
}

function readPath(value: ArtifactLiteral, path: readonly string[] = []): ArtifactLiteral {
  let current: ArtifactLiteral = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) return null;
    current = current[segment]!;
  }
  return current;
}

function transform(value: ArtifactLiteral, operation: 'identity' | 'count' | 'sum' | 'average' | 'first' | 'last' | undefined): ArtifactLiteral {
  if (!operation || operation === 'identity') return value;
  if (operation === 'count') return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
  if (operation === 'first') return Array.isArray(value) ? value[0] ?? null : value;
  if (operation === 'last') return Array.isArray(value) ? value.at(-1) ?? null : value;
  if (!Array.isArray(value)) return null;
  const numbers = value.filter((item): item is number => typeof item === 'number');
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, number) => total + number, 0);
  return operation === 'average' ? sum / numbers.length : sum;
}

function assertContext(artifact: Artifact, context: ArtifactResolveContext) {
  if (artifact.organizationKey !== context.organizationKey || artifact.scopeKey !== context.scopeKey) throw new ArtifactAuthorizationError('Artifact is outside the selected organization or scope');
}

async function assertAcyclic(targetKey: string, definition: ArtifactDefinition, context: ArtifactResolveContext, repository: ArtifactRepository) {
  const visit = async (key: string, path: Set<string>): Promise<void> => {
    if (key === targetKey) throw new ArtifactCycleError('Artifact references would create a cycle');
    if (path.has(key)) throw new ArtifactCycleError('Existing artifact reference cycle detected');
    const artifact = await repository.getArtifact(key);
    if (!artifact) throw new ArtifactNotFoundError(`Referenced artifact ${key} was not found`);
    assertContext(artifact, context);
    const next = new Set(path).add(key);
    for (const binding of Object.values(artifact.definition.bindings)) if (binding.kind === 'artifact') await visit(binding.artifactKey, next);
  };
  for (const binding of Object.values(definition.bindings)) if (binding.kind === 'artifact') await visit(binding.artifactKey, new Set());
}

function dependenciesFor(artifact: Artifact): ArtifactDependency[] {
  const now = new Date().toISOString();
  const base = { artifactKey: artifact.key, organizationKey: artifact.organizationKey, scopeKey: artifact.scopeKey, createdAt: now };
  const dependencies: ArtifactDependency[] = [
    { key: newId(), ...base, dependencyType: 'scope', nodeType: null, nodeKey: artifact.scopeKey, queryId: null, referencedArtifactKey: null },
    { key: newId(), ...base, dependencyType: 'organization', nodeType: null, nodeKey: artifact.organizationKey, queryId: null, referencedArtifactKey: null },
  ];
  for (const binding of Object.values(artifact.definition.bindings)) {
    if (binding.kind === 'node') dependencies.push({ key: newId(), ...base, dependencyType: 'node', nodeType: binding.ref.type, nodeKey: binding.ref.key, queryId: null, referencedArtifactKey: null });
    if (binding.kind === 'query') dependencies.push({ key: newId(), ...base, dependencyType: 'query', nodeType: null, nodeKey: null, queryId: binding.queryId, referencedArtifactKey: null });
    if (binding.kind === 'artifact') dependencies.push({ key: newId(), ...base, dependencyType: 'artifact', nodeType: null, nodeKey: null, queryId: null, referencedArtifactKey: binding.artifactKey });
  }
  return dependencies;
}

function assertRegisteredQueries(definition: ArtifactDefinition) {
  for (const binding of Object.values(definition.bindings)) {
    if (binding.kind === 'query' && !isRegisteredArtifactQuery(binding.queryId)) throw new Error(`Artifact query is not registered: ${binding.queryId}`);
  }
}

async function resolveDefinition(
  definition: ArtifactDefinition,
  context: ArtifactResolveContext,
  repository: ArtifactRepository,
  resolvingArtifacts: Set<string>,
): Promise<{ values: Record<string, ArtifactLiteral>; revisions: Record<string, string> }> {
  const values: Record<string, ArtifactLiteral> = {};
  const revisions: Record<string, string> = {};
  const pending = new Set(Object.keys(definition.bindings));
  const resolvingAliases = new Set<string>();

  const resolveAlias = async (alias: string): Promise<void> => {
    if (!pending.has(alias)) return;
    if (resolvingAliases.has(alias)) throw new ArtifactCycleError(`Binding cycle detected at ${alias}`);
    resolvingAliases.add(alias);
    const binding = definition.bindings[alias]!;
    if (binding.kind === 'literal') {
      values[alias] = binding.value; revisions[alias] = 'literal'; pending.delete(alias); resolvingAliases.delete(alias); return;
    }
    if (binding.kind === 'node') {
      const result = await resolveArtifactNode(binding.ref, context);
      values[alias] = transform(readPath(result.value, binding.path), binding.transform); revisions[alias] = result.revision; pending.delete(alias); resolvingAliases.delete(alias); return;
    }
    if (binding.kind === 'artifact') {
      if (resolvingArtifacts.has(binding.artifactKey)) throw new ArtifactCycleError('Artifact resolution cycle detected');
      const referenced = await repository.getArtifact(binding.artifactKey);
      if (!referenced) throw new ArtifactNotFoundError(`Referenced artifact ${binding.artifactKey} was not found`);
      assertContext(referenced, context);
      const nested = await resolveStoredArtifact(referenced, context, repository, new Set(resolvingArtifacts).add(binding.artifactKey));
      values[alias] = transform(readPath(nested.resolved, binding.path), binding.transform);
      revisions[alias] = Object.values(nested.revisions).join(':'); pending.delete(alias); resolvingAliases.delete(alias); return;
    }
    if (!isRegisteredArtifactQuery(binding.queryId)) throw new Error(`Artifact query is not registered: ${binding.queryId}`);
    const variables: Record<string, ArtifactLiteral> = {};
    for (const [name, variable] of Object.entries(binding.variables)) {
      if (variable.kind === 'literal') variables[name] = variable.value;
      if (variable.kind === 'context') variables[name] = context[variable.value];
      if (variable.kind === 'binding') { await resolveAlias(variable.binding); variables[name] = values[variable.binding] ?? null; }
    }
    const result = await resolveArtifactQuery(binding.queryId, variables, context);
    values[alias] = transform(readPath(result.value, binding.path), binding.transform); revisions[alias] = result.revision; pending.delete(alias); resolvingAliases.delete(alias);
  };
  for (const alias of [...pending]) await resolveAlias(alias);
  return { values, revisions };
}

async function resolveStoredArtifact(artifact: Artifact, context: ArtifactResolveContext, repository: ArtifactRepository, resolving = new Set<string>([artifact.key])): Promise<ResolvedArtifact> {
  assertContext(artifact, context);
  if (artifact.definition.mode === 'snapshot') {
    const snapshot = artifact.snapshotKey ? await repository.getSnapshot(artifact.snapshotKey) : null;
    if (!snapshot) throw new ArtifactNotFoundError('Artifact snapshot was not found');
    return { artifact, resolved: snapshot.values, revisions: snapshot.revisions };
  }
  const result = await resolveDefinition(artifact.definition, context, repository, resolving);
  return { artifact, resolved: result.values, revisions: result.revisions };
}

export function createArtifactService(repository: ArtifactRepository = getDefaultArtifactRepository()) {
  return {
    async create(input: { organizationKey: string; scopeKey: string; name: string; definition: ArtifactDefinition; createdByAgentRunKey?: string | null; createdByUserOrganizationKey?: string | null }) {
      const definition = artifactDefinitionSchema.parse(input.definition);
      assertRegisteredQueries(definition);
      const key = newId();
      await assertAcyclic(key, definition, input, repository);
      const now = new Date().toISOString();
      const snapshotKey = definition.mode === 'snapshot' ? newId() : null;
      const artifact = artifactSchema.parse({ ...input, key, definition, schemaVersion: 1, snapshotKey, createdByAgentRunKey: input.createdByAgentRunKey ?? null, createdByUserOrganizationKey: input.createdByUserOrganizationKey ?? null, createdAt: now, updatedAt: now });
      if (snapshotKey) {
        const resolved = await resolveDefinition(definition, input, repository, new Set([key]));
        await repository.insertSnapshot({ key: snapshotKey, artifactKey: key, values: resolved.values, revisions: resolved.revisions, createdAt: now });
      } else await resolveDefinition(definition, input, repository, new Set([key]));
      const saved = await repository.insertArtifact(artifact);
      await repository.replaceDependencies(saved.key, dependenciesFor(saved));
      return saved;
    },
    async update(key: string, input: { name: string; definition: ArtifactDefinition }, context: ArtifactResolveContext) {
      const current = await repository.getArtifact(key); if (!current) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(current, context);
      const definition = artifactDefinitionSchema.parse(input.definition); await assertAcyclic(key, definition, context, repository);
      assertRegisteredQueries(definition);
      const now = new Date().toISOString(); let snapshotKey: string | null = null;
      if (definition.mode === 'snapshot') {
        snapshotKey = newId(); const resolved = await resolveDefinition(definition, context, repository, new Set([key]));
        await repository.insertSnapshot({ key: snapshotKey, artifactKey: key, values: resolved.values, revisions: resolved.revisions, createdAt: now });
      } else await resolveDefinition(definition, context, repository, new Set([key]));
      const saved = await repository.updateArtifact(key, { name: input.name, definition, snapshotKey, updatedAt: now });
      await repository.replaceDependencies(saved.key, dependenciesFor(saved)); return saved;
    },
    async get(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(artifact, context); return artifact; },
    list(context: ArtifactResolveContext) { return repository.listArtifacts(context.organizationKey, context.scopeKey); },
    async remove(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(artifact, context); await repository.deleteArtifact(key); },
    async resolve(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); return resolveStoredArtifact(artifact, context, repository); },
  };
}

let defaultService: ReturnType<typeof createArtifactService> | null = null;
export function getDefaultArtifactService() { defaultService ??= createArtifactService(); return defaultService; }
