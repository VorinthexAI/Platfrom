import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { nodeTypeSchema, sourceSelectionSchema, type SourceSelection } from '@/lib/ai/agent-run-sources';

export const artifactReferenceSchema = z.object({
  nodeType: nodeTypeSchema,
  nodeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(2_000),
}).strict();
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export interface OwnedArtifactReference extends ArtifactReference {
  organizationKey: string;
  scopeKey: string | null;
}
export interface SimilarArtifact {
  reference: OwnedArtifactReference;
  similarity: number;
}
export interface ArtifactResolver<TContent = unknown> {
  exists(nodeKey: string): Promise<boolean>;
  getReference(nodeKey: string): Promise<OwnedArtifactReference | null>;
  getContent(nodeKey: string): Promise<TContent | null>;
  findSimilar(embedding: readonly number[], limit: number): Promise<readonly SimilarArtifact[]>;
}

export class ArtifactResolverNotFoundError extends AiError {
  constructor(nodeType: string) { super('artifact_resolver_not_found', `No artifact resolver is registered for ${nodeType}`); }
}
export class ArtifactSourceNotFoundError extends AiError {
  constructor(nodeType: string, nodeKey: string) { super('artifact_source_not_found', `${nodeType}/${nodeKey} does not exist`); }
}
export class ArtifactSourceOrganizationError extends AiError {
  constructor(nodeType: string, nodeKey: string) { super('artifact_source_organization_mismatch', `${nodeType}/${nodeKey} belongs to another organization`); }
}
export class ArtifactSourcePermissionError extends AiError {
  constructor(nodeType: string, nodeKey: string) { super('artifact_source_permission_denied', `Agent may not use ${nodeType}/${nodeKey} as a source`); }
}

export interface SourcePermissionInput {
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
  source: OwnedArtifactReference;
}
export type SourcePermissionResolver = (input: SourcePermissionInput) => boolean | Promise<boolean>;

export class ArtifactResolverRegistry {
  readonly #resolvers = new Map<string, ArtifactResolver>();
  register(nodeType: string, resolver: ArtifactResolver): this {
    const type = nodeTypeSchema.parse(nodeType);
    if (this.#resolvers.has(type)) throw new Error(`Artifact resolver already registered: ${type}`);
    this.#resolvers.set(type, resolver);
    return this;
  }
  get(nodeType: string): ArtifactResolver {
    const type = nodeTypeSchema.parse(nodeType);
    const resolver = this.#resolvers.get(type);
    if (!resolver) throw new ArtifactResolverNotFoundError(type);
    return resolver;
  }
  has(nodeType: string): boolean { return this.#resolvers.has(nodeType); }
}

export interface ResolveArtifactSourcesOptions {
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
  selections: readonly SourceSelection[];
  registry: ArtifactResolverRegistry;
  canUseSource?: SourcePermissionResolver;
}

/** Resolves only compact references; full domain documents stay behind tools. */
export async function resolveArtifactSources(options: ResolveArtifactSourcesOptions): Promise<readonly ArtifactReference[]> {
  const selections = z.array(sourceSelectionSchema).parse(options.selections)
    .sort((left, right) => right.priority - left.priority || left.nodeType.localeCompare(right.nodeType) || left.nodeKey.localeCompare(right.nodeKey));
  const seen = new Set<string>();
  const references: ArtifactReference[] = [];
  for (const selection of selections) {
    const identity = `${selection.nodeType}/${selection.nodeKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const resolver = options.registry.get(selection.nodeType);
    if (!(await resolver.exists(selection.nodeKey))) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
    const owned = await resolver.getReference(selection.nodeKey);
    if (!owned) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
    if (owned.nodeType !== selection.nodeType || owned.nodeKey !== selection.nodeKey) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
    if (owned.organizationKey !== options.organizationKey) throw new ArtifactSourceOrganizationError(selection.nodeType, selection.nodeKey);
    const defaultAllowed = owned.scopeKey === null || owned.scopeKey === options.scopeKey;
    const allowed = options.canUseSource ? await options.canUseSource({ organizationKey: options.organizationKey, scopeKey: options.scopeKey, agentKey: options.agentKey, source: owned }) : defaultAllowed;
    if (!allowed) throw new ArtifactSourcePermissionError(selection.nodeType, selection.nodeKey);
    references.push(artifactReferenceSchema.parse({ nodeType: owned.nodeType, nodeKey: owned.nodeKey, name: owned.name, summary: owned.summary }));
  }
  return references;
}

/** Server-side primitive for a granted retrieval tool; repeats ownership and permission checks. */
export async function resolveArtifactContent<TContent = unknown>(options: Omit<ResolveArtifactSourcesOptions, 'selections'> & { nodeType: string; nodeKey: string }): Promise<TContent> {
  const selection = sourceSelectionSchema.parse({ nodeType: options.nodeType, nodeKey: options.nodeKey, priority: 0 });
  const resolver = options.registry.get(selection.nodeType) as ArtifactResolver<TContent>;
  if (!(await resolver.exists(selection.nodeKey))) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
  const owned = await resolver.getReference(selection.nodeKey);
  if (!owned || owned.nodeType !== selection.nodeType || owned.nodeKey !== selection.nodeKey) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
  if (owned.organizationKey !== options.organizationKey) throw new ArtifactSourceOrganizationError(selection.nodeType, selection.nodeKey);
  const defaultAllowed = owned.scopeKey === null || owned.scopeKey === options.scopeKey;
  const allowed = options.canUseSource ? await options.canUseSource({ organizationKey: options.organizationKey, scopeKey: options.scopeKey, agentKey: options.agentKey, source: owned }) : defaultAllowed;
  if (!allowed) throw new ArtifactSourcePermissionError(selection.nodeType, selection.nodeKey);
  const content = await resolver.getContent(selection.nodeKey);
  if (content === null) throw new ArtifactSourceNotFoundError(selection.nodeType, selection.nodeKey);
  return content;
}

export const defaultArtifactResolverRegistry = new ArtifactResolverRegistry();
