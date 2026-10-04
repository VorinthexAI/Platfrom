import { db } from '@/lib/db/client';
import { embedText } from '@/lib/embeddings';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';

const LANE_LIMIT = 100;
const FUSED_LIMIT = 50;
const RRF_CONSTANT = 60;

type CandidateInput = { query: string; folderKeys?: string[]; extensions?: string[]; includeManaged: boolean };

// Every lane applies the same ownership and selector filters before ranking.
const ownedFiles = `
  FOR file IN files
    FILTER file.userKey == @userKey && file.scopeKey == @scopeKey && file.isHidden != true
    FILTER @folderKeys == null || file.folderKey IN @folderKeys
    FILTER @extensions == null || file.extension IN @extensions
    FILTER @includeManaged || file.managedPurpose == null`;

export function reciprocalRankFusion(lanes: readonly (readonly string[])[], limit = FUSED_LIMIT) {
  const scores = new Map<string, { score: number; firstRank: number }>();
  for (const lane of lanes) {
    const unique = new Set<string>();
    lane.forEach((key, index) => {
      if (unique.has(key)) return;
      unique.add(key);
      const current = scores.get(key) ?? { score: 0, firstRank: index };
      current.score += 1 / (RRF_CONSTANT + index + 1);
      current.firstRank = Math.min(current.firstRank, index);
      scores.set(key, current);
    });
  }
  return [...scores].sort(([left, a], [right, b]) => b.score - a.score || a.firstRank - b.firstRank || left.localeCompare(right)).slice(0, limit).map(([key]) => key);
}

export async function workspaceCandidateKeys(context: ToolContext, input: CandidateInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const bind = {
    userKey: contextUserKey(context), scopeKey: context.runtimeScopeKey,
    folderKeys: input.folderKeys ?? null, extensions: input.extensions ?? null,
    includeManaged: input.includeManaged, limit: LANE_LIMIT,
  };
  const terms = [...new Set(input.query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((term) => term.length >= 3) ?? [])].slice(0, 12);
  const vector = (async () => {
    const embedding = await embedText({ text: input.query, purpose: 'query' }).catch(() => [] as number[]);
    if (!embedding.length) return [];
    signal?.throwIfAborted();
    const cursor = await db.query(`
      ${ownedFiles}
      FILTER IS_ARRAY(file.embedding) && LENGTH(file.embedding) == @dimensions
      LET similarity = COSINE_SIMILARITY(file.embedding, @embedding)
      FILTER IS_NUMBER(similarity)
      SORT similarity DESC, file._key ASC
      LIMIT @limit
      RETURN file._key
    `, { ...bind, embedding, dimensions: embedding.length });
    return await cursor.all() as string[];
  })();
  const keyword = (async () => {
    if (!terms.length) return [];
    const cursor = await db.query(`
      ${ownedFiles}
      LET hits = SUM(FOR term IN @terms RETURN CONTAINS(LOWER(file.name), term) ? 1 : 0)
      FILTER hits > 0
      LET exactName = CONTAINS(@needle, LOWER(file.name))
      SORT exactName DESC, hits DESC, LENGTH(file.name) ASC, file._key ASC
      LIMIT @limit
      RETURN file._key
    `, { ...bind, terms, needle: input.query.toLocaleLowerCase() });
    return await cursor.all() as string[];
  })();
  const metadata = (async () => {
    if (!input.extensions && !input.folderKeys) return [];
    const cursor = await db.query(`
      ${ownedFiles}
      SORT (file.processing == "ready") DESC, file.updatedAt DESC, file._key ASC
      LIMIT @limit
      RETURN file._key
    `, bind);
    return await cursor.all() as string[];
  })();
  const lanes = await Promise.all([vector, keyword, metadata]);
  signal?.throwIfAborted();
  return reciprocalRankFusion(lanes);
}
