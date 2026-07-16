import { normalizeKnowledgeBlock, type KnowledgeBlock } from './schema';
import type { RankedKnowledgeBlock } from './ranking';
import { KnowledgeBudgetManager } from './budget';

export type KnowledgeSummarizer = (content: string, block: KnowledgeBlock) => Promise<string>;
export interface CompressionOptions {
  tokenBudget: number;
  summarizer?: KnowledgeSummarizer;
  maxSummaryCharacters?: number;
  maxContentCharacters?: number;
}
export interface CompressionResult {
  blocks: KnowledgeBlock[];
  estimatedTokens: number;
  compressedBlocks: number;
  droppedBlocks: number;
}

export function estimateKnowledgeTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function trim(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

/** Compression order is fixed: deduplicate, trim, summarize, then drop. */
export async function compressKnowledgeBlocks(ranked: readonly RankedKnowledgeBlock[], options: CompressionOptions): Promise<CompressionResult> {
  const budget = new KnowledgeBudgetManager(options.tokenBudget);
  const maxSummary = options.maxSummaryCharacters ?? 800;
  const maxContent = options.maxContentCharacters ?? 3_000;
  const seen = new Set<string>();
  const deduplicated = ranked.filter(({ block }) => {
    const identity = `${block.nodeType}/${block.nodeKey}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  let compressedBlocks = ranked.length - deduplicated.length;
  const blocks: KnowledgeBlock[] = [];
  for (const candidate of deduplicated) {
    let summary = trim(candidate.block.summary, maxSummary);
    let content = candidate.block.content === null ? null : trim(candidate.block.content, maxContent);
    if (summary !== candidate.block.summary || content !== candidate.block.content) compressedBlocks += 1;
    let block = normalizeKnowledgeBlock({ ...candidate.block, summary, content });
    if (options.summarizer && content && budget.estimate(block) > Math.max(64, Math.floor(options.tokenBudget / 4))) {
      summary = trim((await options.summarizer(content, block)).trim(), maxSummary);
      content = null;
      block = normalizeKnowledgeBlock({ ...block, summary, content });
      compressedBlocks += 1;
    }
    blocks.push(block);
  }
  const fitted = budget.dropLowestUntilFit(blocks);
  return { blocks: fitted.values, estimatedTokens: fitted.estimatedTokens, compressedBlocks, droppedBlocks: fitted.dropped };
}
