import { compressKnowledgeBlocks, type CompressionOptions } from './compression';
import { knowledgePackSchema, type KnowledgePack } from './schema';
import type { RankedKnowledgeBlock } from './ranking';

export interface BuildKnowledgePackOptions extends CompressionOptions { query: string }

export async function buildKnowledgePack(ranked: readonly RankedKnowledgeBlock[], options: BuildKnowledgePackOptions): Promise<KnowledgePack> {
  const query = options.query.trim();
  if (!query) throw new Error('Knowledge pack query cannot be empty');
  const compressed = await compressKnowledgeBlocks(ranked, options);
  return knowledgePackSchema.parse({
    query,
    blocks: compressed.blocks,
    budget: {
      limitTokens: options.tokenBudget,
      estimatedTokens: compressed.estimatedTokens,
      compressedBlocks: compressed.compressedBlocks,
      droppedBlocks: compressed.droppedBlocks,
    },
  });
}

export function emptyKnowledgePack(query: string, tokenBudget = 4_000): KnowledgePack {
  return knowledgePackSchema.parse({ query: query.trim(), blocks: [], budget: { limitTokens: tokenBudget, estimatedTokens: 1, compressedBlocks: 0, droppedBlocks: 0 } });
}
