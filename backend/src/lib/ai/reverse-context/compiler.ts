import { z } from 'zod';
import { embedText } from '@/lib/bedrock-titan';
import { sourceSelectionSchema, type SourceSelection } from '@/lib/ai/agent-run-sources';
import { buildKnowledgePack } from './knowledge-pack';
import { rankKnowledgeBlocks } from './ranking';
import { knowledgeBlockSchema, normalizeKnowledgeBlock, searchableNodeSchema, type KnowledgePack, type SearchableNode } from './schema';
import { NodeContextNotFoundError, NodeResolverRegistry, nodeSimilaritySchema, type ResolverAccess } from './resolver';
import type { KnowledgeSummarizer } from './compression';
import { organizationKeySchema } from '@/lib/ai/shared/ids';

export interface ReverseContextCompilerOptions {
  registry: NodeResolverRegistry;
  generateEmbedding?: (query: string) => Promise<readonly number[]>;
  canUseNode?: (node: SearchableNode, access: ResolverAccess) => boolean | Promise<boolean>;
  summarizer?: KnowledgeSummarizer;
  defaultTopN?: number;
  defaultTokenBudget?: number;
}
export interface CompileReverseContextInput extends ResolverAccess {
  query: string;
  nodeTypes?: readonly string[];
  manualSources?: readonly SourceSelection[];
  topN?: number;
  tokenBudget?: number;
}

async function assertNodeAllowed(node: SearchableNode, access: ResolverAccess, permission?: ReverseContextCompilerOptions['canUseNode']) {
  if (node.organizationKey !== access.organizationKey) return false;
  if (permission) return permission(node, access);
  return node.scopeKey === null || node.scopeKey === access.scopeKey;
}

/** Converts authorized vector results into a bounded, provider-safe knowledge pack. */
export class ReverseContextCompiler {
  constructor(private readonly options: ReverseContextCompilerOptions) {}

  async compile(input: CompileReverseContextInput): Promise<KnowledgePack> {
    const access = z.object({ organizationKey: organizationKeySchema, scopeKey: z.string().cuid(), agentKey: z.string().cuid() }).strict().parse({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, agentKey: input.agentKey });
    const query = input.query.trim();
    if (!query) throw new Error('Reverse-context query cannot be empty');
    const topN = z.number().int().min(1).max(100).parse(input.topN ?? this.options.defaultTopN ?? 20);
    const tokenBudget = z.number().int().min(64).max(200_000).parse(input.tokenBudget ?? this.options.defaultTokenBudget ?? 4_000);
    const manualSources = z.array(sourceSelectionSchema).parse(input.manualSources ?? []);
    const nodeTypes = [...new Set((input.nodeTypes ?? this.options.registry.listNodeTypes()).map((type) => this.options.registry.get(type).nodeType))];
    const queryEmbedding = await (this.options.generateEmbedding ?? (async (text: string) => embedText({ text })))(query);

    const candidates: Array<Parameters<typeof rankKnowledgeBlocks>[0][number]> = [];
    for (const source of manualSources.sort((left, right) => right.priority - left.priority)) {
      const resolver = this.options.registry.get(source.nodeType);
      if (!await resolver.exists(source.nodeKey, access)) throw new NodeContextNotFoundError(source.nodeType, source.nodeKey);
      const node = await resolver.load(source.nodeKey, access);
      if (!node) throw new NodeContextNotFoundError(source.nodeType, source.nodeKey);
      const parsedNode = searchableNodeSchema.parse(node);
      if (!await assertNodeAllowed(parsedNode, access, this.options.canUseNode)) throw new NodeContextNotFoundError(source.nodeType, source.nodeKey);
      const extracted = knowledgeBlockSchema.parse(await resolver.extractContext(parsedNode, access, { full: false }));
      const block = normalizeKnowledgeBlock({ ...extracted, content: null });
      if (block.nodeType !== source.nodeType || block.nodeKey !== source.nodeKey) throw new NodeContextNotFoundError(source.nodeType, source.nodeKey);
      candidates.push({ block, source: 'manual', similarity: 1, priority: source.priority, updatedAt: parsedNode.updatedAt });
    }

    const automaticMatches = (await Promise.all(nodeTypes.map(async (nodeType) => {
      const resolver = this.options.registry.get(nodeType);
      return (await resolver.findSimilar(queryEmbedding, topN, access)).map((match) => ({ resolver, nodeType, match: nodeSimilaritySchema.parse(match) }));
    }))).flat().sort((left, right) => right.match.similarity - left.match.similarity || left.nodeType.localeCompare(right.nodeType) || left.match.nodeKey.localeCompare(right.match.nodeKey)).slice(0, topN);

    for (const { resolver, nodeType, match } of automaticMatches) {
      const node = await resolver.load(match.nodeKey, access);
      if (!node) continue;
      const parsedNode = searchableNodeSchema.parse(node);
      if (!await assertNodeAllowed(parsedNode, access, this.options.canUseNode)) continue;
      const extracted = knowledgeBlockSchema.parse(await resolver.extractContext(parsedNode, access, { full: false }));
      const block = normalizeKnowledgeBlock({ ...extracted, content: null });
      if (block.nodeType !== nodeType || block.nodeKey !== match.nodeKey) continue;
      candidates.push({ block, source: 'automatic', similarity: match.similarity, priority: 0, updatedAt: parsedNode.updatedAt });
    }

    return buildKnowledgePack(rankKnowledgeBlocks(candidates), { query, tokenBudget, summarizer: this.options.summarizer });
  }
}
