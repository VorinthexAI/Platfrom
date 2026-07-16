import type { KnowledgeBlock } from './schema';

export interface RankedKnowledgeBlock {
  block: KnowledgeBlock;
  source: 'manual' | 'automatic';
  similarity: number;
  priority: number;
  freshness: number;
  score: number;
}

function freshnessScore(updatedAt: string | null, nowMs: number) {
  if (!updatedAt) return 0;
  const ageDays = Math.max(0, (nowMs - Date.parse(updatedAt)) / 86_400_000);
  return Math.exp(-ageDays / 30);
}

export function rankKnowledgeBlocks(
  candidates: ReadonlyArray<Omit<RankedKnowledgeBlock, 'freshness' | 'score'> & { updatedAt: string | null }>,
  nowMs = Date.now(),
): RankedKnowledgeBlock[] {
  return candidates.map((candidate) => {
    const freshness = freshnessScore(candidate.updatedAt, nowMs);
    const score = candidate.similarity * 0.75 + Math.min(Math.max(candidate.priority, 0), 100) / 100 * 0.15 + freshness * 0.10;
    return { block: candidate.block, source: candidate.source, similarity: candidate.similarity, priority: candidate.priority, freshness, score };
  }).sort((left, right) => {
    if (left.source !== right.source) return left.source === 'manual' ? -1 : 1;
    return right.score - left.score || right.priority - left.priority || left.block.nodeType.localeCompare(right.block.nodeType) || left.block.nodeKey.localeCompare(right.block.nodeKey);
  });
}
