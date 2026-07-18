import { newId } from '@/lib/ids';
import {
  artifactDefinitionSchema,
  artifactSchema,
  resolvedArtifactGraphSchema,
  type Artifact,
  type ArtifactDefinition,
  type ArtifactDependency,
  type ArtifactLiteral,
  type ResolvedArtifactGraph,
  type SemanticGraphNode,
} from './schema';
import { getDefaultArtifactRepository, type ArtifactRepository } from './repository';
import { isRegisteredArtifactQuery, resolveArtifactNode, resolveArtifactQuery, type ArtifactResolveContext } from './registry';
import type { NodeRef } from './types';

export class ArtifactNotFoundError extends Error {}
export class ArtifactAuthorizationError extends Error {}
export class ArtifactCycleError extends Error {}

export interface ResolvedArtifact {
  artifact: Artifact;
  graph: ResolvedArtifactGraph;
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

function asRecord(value: ArtifactLiteral): Record<string, ArtifactLiteral> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function sceneRef(value: ArtifactLiteral): { nodeType: string; nodeKey: string } | null {
  const record = asRecord(value); const ref = record ? asRecord(record.ref) : null;
  return ref && typeof ref.nodeType === 'string' && typeof ref.nodeKey === 'string' ? { nodeType: ref.nodeType, nodeKey: ref.nodeKey } : null;
}

function parentRef(value: ArtifactLiteral): { nodeType: string; nodeKey: string } | null {
  const record = asRecord(value); const ref = record ? asRecord(record.parentRef) : null;
  return ref && typeof ref.nodeType === 'string' && typeof ref.nodeKey === 'string' ? { nodeType: ref.nodeType, nodeKey: ref.nodeKey } : null;
}

function nodeState(value: ArtifactLiteral): SemanticGraphNode['state'] {
  if (typeof value === 'boolean') return value ? 'active' : 'archived';
  if (typeof value !== 'string') return 'default';
  const normalized = value.toLowerCase();
  if (['active', 'completed', 'enabled', 'online'].includes(normalized)) return 'active';
  if (['archived', 'inactive', 'suspended', 'cancelled', 'disabled'].includes(normalized)) return 'archived';
  if (['warning', 'failed', 'rejected', 'timeout', 'blocked'].includes(normalized)) return 'warning';
  return 'default';
}

function displayLabel(value: ArtifactLiteral, ref: { nodeType: string; nodeKey: string }): string {
  const record = asRecord(value);
  for (const key of ['label', 'name', 'title', 'slug', 'reason']) {
    const candidate = record?.[key]; if (typeof candidate === 'string' && candidate.trim()) return candidate.slice(0, 240);
  }
  return `${ref.nodeType}/${ref.nodeKey}`;
}

export function compileArtifactGraph(definition: ArtifactDefinition, values: Record<string, ArtifactLiteral>): ResolvedArtifactGraph {
  const groups = new Map<string, SemanticGraphNode[]>();
  for (const [group, declaration] of Object.entries(definition.nodes)) {
    const bound = values[declaration.binding];
    const rows = Array.isArray(bound) ? bound : bound === undefined || bound === null ? [] : [bound];
    const nodes: SemanticGraphNode[] = rows.map((row) => {
      const ref = sceneRef(row);
      if (!ref) throw new Error(`Binding ${declaration.binding} must resolve graph nodes with a NodeRef`);
      const record = asRecord(row);
      const labelValue = declaration.labelPath ? readPath(row, declaration.labelPath) : null;
      const stateValue = declaration.statePath ? readPath(row, declaration.statePath) : record?.state ?? record?.status ?? 'default';
      const weightValue = declaration.weightPath ? readPath(row, declaration.weightPath) : record?.weight ?? 1;
      const parent = parentRef(row);
      return {
        id: `${group}:${ref.nodeType}:${ref.nodeKey}`,
        ref,
        group,
        kind: declaration.kind,
        label: typeof labelValue === 'string' && labelValue.trim() ? labelValue.slice(0, 240) : displayLabel(row, ref),
        state: nodeState(stateValue),
        weight: typeof weightValue === 'number' && Number.isFinite(weightValue) ? Math.max(0, Math.min(1_000, weightValue)) : 1,
        parentRef: parent,
        clusterId: typeof record?.clusterId === 'string' ? record.clusterId : parent?.nodeKey ?? null,
        appearance: declaration.appearance,
        details: row,
      };
    });
    groups.set(group, nodes);
  }

  const nodes = [...groups.values()].flat();
  const edges: ResolvedArtifactGraph['edges'] = [];
  const seen = new Set<string>();
  for (const declaration of definition.edges) {
    const fromNodes = groups.get(declaration.from) ?? [];
    const toNodes = groups.get(declaration.to) ?? [];
    for (const target of toNodes) {
      let sources = target.parentRef ? fromNodes.filter((source) => source.ref.nodeType === target.parentRef?.nodeType && source.ref.nodeKey === target.parentRef?.nodeKey) : [];
      if (sources.length === 0 && fromNodes.length === 1) sources = fromNodes;
      for (const source of sources) {
        const id = `${source.id}:${declaration.relation}:${target.id}`;
        if (seen.has(id)) continue;
        seen.add(id); edges.push({ id, from: source.id, to: target.id, relation: declaration.relation, directed: declaration.directed });
      }
    }
  }
  return resolvedArtifactGraphSchema.parse({ nodes, edges });
}

function assertContext(artifact: Artifact, context: ArtifactResolveContext) {
  if (artifact.organizationKey !== context.organizationKey || artifact.scopeKey !== context.scopeKey) throw new ArtifactAuthorizationError('Artifact is outside the selected organization or scope');
}

async function assertAcyclic(targetKey: string, definition: ArtifactDefinition, context: ArtifactResolveContext, repository: ArtifactRepository) {
  const visit = async (key: string, path: Set<string>): Promise<void> => {
    if (key === targetKey) throw new ArtifactCycleError('Artifact references would create a cycle');
    if (path.has(key)) throw new ArtifactCycleError('Existing artifact reference cycle detected');
    const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError(`Referenced artifact ${key} was not found`);
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
  for (const binding of Object.values(definition.bindings)) if (binding.kind === 'query' && !isRegisteredArtifactQuery(binding.queryId)) throw new Error(`Artifact query is not registered: ${binding.queryId}`);
}

async function resolveDefinition(definition: ArtifactDefinition, context: ArtifactResolveContext, repository: ArtifactRepository, resolvingArtifacts: Set<string>) {
  const values: Record<string, ArtifactLiteral> = {}; const revisions: Record<string, string> = {};
  const pending = new Set(Object.keys(definition.bindings)); const resolvingAliases = new Set<string>();
  const resolveAlias = async (alias: string): Promise<void> => {
    if (!pending.has(alias)) return;
    if (resolvingAliases.has(alias)) throw new ArtifactCycleError(`Binding cycle detected at ${alias}`);
    resolvingAliases.add(alias);
    const binding = definition.bindings[alias]!;
    if (binding.kind === 'node') {
      const result = await resolveArtifactNode(binding.ref, context); values[alias] = readPath(result.value, binding.path); revisions[alias] = result.revision;
    } else if (binding.kind === 'artifact') {
      if (resolvingArtifacts.has(binding.artifactKey)) throw new ArtifactCycleError('Artifact resolution cycle detected');
      const referenced = await repository.getArtifact(binding.artifactKey); if (!referenced) throw new ArtifactNotFoundError(`Referenced artifact ${binding.artifactKey} was not found`);
      assertContext(referenced, context);
      const nested = await resolveStoredArtifact(referenced, context, repository, new Set(resolvingArtifacts).add(binding.artifactKey));
      const nestedValues = nested.graph.nodes.map((node) => ({ ...asRecord(node.details), ref: node.ref, parentRef: node.parentRef, label: node.label, state: node.state, weight: node.weight, clusterId: node.clusterId }));
      values[alias] = readPath(nestedValues, binding.path); revisions[alias] = Object.values(nested.revisions).join(':');
    } else {
      const variables: Record<string, ArtifactLiteral> = {};
      for (const [name, variable] of Object.entries(binding.variables)) {
        if (variable.kind === 'literal') variables[name] = variable.value;
        if (variable.kind === 'context') variables[name] = context[variable.value];
        if (variable.kind === 'binding') { await resolveAlias(variable.binding); variables[name] = values[variable.binding] ?? null; }
      }
      const result = await resolveArtifactQuery(binding.queryId, variables, context); values[alias] = readPath(result.value, binding.path); revisions[alias] = result.revision;
    }
    pending.delete(alias); resolvingAliases.delete(alias);
  };
  for (const alias of [...pending]) await resolveAlias(alias);
  return { graph: compileArtifactGraph(definition, values), revisions };
}

async function resolveStoredArtifact(artifact: Artifact, context: ArtifactResolveContext, repository: ArtifactRepository, resolving = new Set<string>([artifact.key])): Promise<ResolvedArtifact> {
  assertContext(artifact, context);
  if (artifact.definition.mode === 'snapshot') {
    const snapshot = artifact.snapshotKey ? await repository.getSnapshot(artifact.snapshotKey) : null;
    if (!snapshot) throw new ArtifactNotFoundError('Artifact snapshot was not found');
    return { artifact, graph: snapshot.graph, revisions: snapshot.revisions };
  }
  const result = await resolveDefinition(artifact.definition, context, repository, resolving);
  return { artifact, graph: result.graph, revisions: result.revisions };
}

export function createArtifactService(repository: ArtifactRepository = getDefaultArtifactRepository()) {
  return {
    async create(input: ArtifactResolveContext & { name: string; definition: ArtifactDefinition; createdByAgentRunKey?: string | null; createdByUserOrganizationKey?: string | null }) {
      const definition = artifactDefinitionSchema.parse(input.definition); assertRegisteredQueries(definition);
      const key = newId(); await assertAcyclic(key, definition, input, repository);
      const now = new Date().toISOString(); const snapshotKey = definition.mode === 'snapshot' ? newId() : null;
      const artifact = artifactSchema.parse({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, name: input.name, definition, schemaVersion: 1, snapshotKey, createdByAgentRunKey: input.createdByAgentRunKey ?? null, createdByUserOrganizationKey: input.createdByUserOrganizationKey ?? null, createdAt: now, updatedAt: now });
      const resolved = await resolveDefinition(definition, input, repository, new Set([key]));
      if (snapshotKey) await repository.insertSnapshot({ key: snapshotKey, artifactKey: key, graph: resolved.graph, revisions: resolved.revisions, createdAt: now });
      const saved = await repository.insertArtifact(artifact); await repository.replaceDependencies(saved.key, dependenciesFor(saved)); return saved;
    },
    async update(key: string, input: { name: string; definition: ArtifactDefinition }, context: ArtifactResolveContext) {
      const current = await repository.getArtifact(key); if (!current) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(current, context);
      const definition = artifactDefinitionSchema.parse(input.definition); assertRegisteredQueries(definition); await assertAcyclic(key, definition, context, repository);
      const now = new Date().toISOString(); const snapshotKey = definition.mode === 'snapshot' ? newId() : null;
      const resolved = await resolveDefinition(definition, context, repository, new Set([key]));
      if (snapshotKey) await repository.insertSnapshot({ key: snapshotKey, artifactKey: key, graph: resolved.graph, revisions: resolved.revisions, createdAt: now });
      const saved = await repository.updateArtifact(key, { name: input.name, definition, snapshotKey, updatedAt: now }); await repository.replaceDependencies(saved.key, dependenciesFor(saved)); return saved;
    },
    async get(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(artifact, context); return artifact; },
    list(context: ArtifactResolveContext) { return repository.listArtifacts(context.organizationKey, context.scopeKey); },
    async remove(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(artifact, context); await repository.deleteArtifact(key); },
    async resolve(key: string, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); return resolveStoredArtifact(artifact, context, repository); },
    async readNode(key: string, ref: NodeRef, context: ArtifactResolveContext) { const artifact = await repository.getArtifact(key); if (!artifact) throw new ArtifactNotFoundError('Artifact was not found'); assertContext(artifact, context); return resolveArtifactNode(ref, context); },
  };
}

let defaultService: ReturnType<typeof createArtifactService> | null = null;
export function getDefaultArtifactService() { defaultService ??= createArtifactService(); return defaultService; }
