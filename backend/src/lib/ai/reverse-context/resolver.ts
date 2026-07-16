import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { nodeTypeSchema } from '@/lib/ai/agent-run-sources';
import type { KnowledgeBlock, SearchableNode } from './schema';

export interface ResolverAccess {
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
}
export interface NodeSimilarity { nodeKey: string; similarity: number }
export interface ExtractContextOptions { full: boolean }

/** Universal searchable-node boundary. Implementations authorize every method. */
export interface NodeResolver {
  readonly nodeType: string;
  exists(nodeKey: string, access: ResolverAccess): Promise<boolean>;
  load(nodeKey: string, access: ResolverAccess): Promise<SearchableNode | null>;
  findSimilar(embedding: readonly number[], limit: number, access: ResolverAccess): Promise<readonly NodeSimilarity[]>;
  extractContext(node: SearchableNode, access: ResolverAccess, options: ExtractContextOptions): Promise<KnowledgeBlock>;
}

export class NodeResolverNotFoundError extends AiError {
  constructor(nodeType: string) { super('node_resolver_not_found', `No reverse-context resolver is registered for ${nodeType}`); }
}
export class NodeContextNotFoundError extends AiError {
  constructor(nodeType: string, nodeKey: string) { super('node_context_not_found', `${nodeType}/${nodeKey} is unavailable or forbidden`); }
}

export class NodeResolverRegistry {
  readonly #resolvers = new Map<string, NodeResolver>();
  register(resolver: NodeResolver): this {
    const nodeType = nodeTypeSchema.parse(resolver.nodeType);
    if (this.#resolvers.has(nodeType)) throw new Error(`Node resolver already registered: ${nodeType}`);
    this.#resolvers.set(nodeType, resolver);
    return this;
  }
  get(nodeType: string): NodeResolver {
    const parsed = nodeTypeSchema.parse(nodeType);
    const resolver = this.#resolvers.get(parsed);
    if (!resolver) throw new NodeResolverNotFoundError(parsed);
    return resolver;
  }
  has(nodeType: string) { return this.#resolvers.has(nodeType); }
  listNodeTypes() { return [...this.#resolvers.keys()].sort(); }
}

export const nodeSimilaritySchema = z.object({ nodeKey: z.string().cuid(), similarity: z.number().min(-1).max(1) }).strict();
