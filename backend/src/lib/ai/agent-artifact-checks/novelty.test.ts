import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { ArtifactResolverRegistry, type ArtifactResolver } from '@/lib/ai/artifact-resolvers';
import { agentArtifactCheckSchema, type AgentArtifactCheck } from './schema';
import { checkArtifactNovelty, persistArtifactIfNovel } from './novelty';

function setup(similarity: number) {
  const comparedNodeKey = newId(); const organizationKey = newId();
  const resolver: ArtifactResolver = { async exists() { return true; }, async getReference() { return null; }, async getContent() { return null; }, async findSimilar() { return [{ similarity, reference: { nodeType: 'hook', nodeKey: comparedNodeKey, organizationKey, scopeKey: null, name: 'Existing', summary: 'Existing hook' } }]; } };
  const stored: AgentArtifactCheck[] = [];
  const checks = { async insertCheck(input: Parameters<import('./repository').AgentArtifactCheckRepository['insertCheck']>[0]) { const value = agentArtifactCheckSchema.parse({ ...input, key: newId(), createdAt: '2026-07-16T00:00:00.000Z' }); stored.push(value); return value; }, async listChecksForRun() { return stored; } };
  return { registry: new ArtifactResolverRegistry().register('hook', resolver), checks, stored };
}

describe('artifact novelty', () => {
  test('accepts candidates below review threshold and records the comparison', async () => {
    const f = setup(0.79);
    const result = await checkArtifactNovelty({ agentRunKey: newId(), candidateNodeType: 'hook', candidateNodeKey: newId(), candidateText: 'A new hook' }, { resolvers: f.registry, checks: f.checks, generateEmbedding: async () => [1, 0] });
    expect(result.decision).toBe('accepted'); expect(f.stored[0]?.decision).toBe('accepted');
  });
  test('requires revision in review band and rejects at reject threshold', async () => {
    const review = setup(0.85);
    expect((await checkArtifactNovelty({ agentRunKey: newId(), candidateNodeType: 'hook', candidateNodeKey: newId(), candidateText: 'Similar hook' }, { resolvers: review.registry, checks: review.checks, generateEmbedding: async () => [1] })).decision).toBe('revised');
    const reject = setup(0.95);
    expect((await checkArtifactNovelty({ agentRunKey: newId(), candidateNodeType: 'hook', candidateNodeKey: newId(), candidateText: 'Duplicate hook' }, { resolvers: reject.registry, checks: reject.checks, generateEmbedding: async () => [1] })).decision).toBe('rejected');
    expect(reject.stored[0]?.similarity).toBe(0.95);
  });
  test('persists domain objects only after an accepted novelty decision', async () => {
    const accepted = setup(0.2); let writes = 0;
    const saved = await persistArtifactIfNovel({ agentRunKey: newId(), candidateNodeType: 'hook', candidateNodeKey: newId(), candidateText: 'Novel hook' }, async (embedding) => { writes += 1; return { embedding }; }, { resolvers: accepted.registry, checks: accepted.checks, generateEmbedding: async () => [0.2] });
    expect(saved.artifact).toEqual({ embedding: [0.2] }); expect(writes).toBe(1);
    const rejected = setup(0.99);
    const blocked = await persistArtifactIfNovel({ agentRunKey: newId(), candidateNodeType: 'hook', candidateNodeKey: newId(), candidateText: 'Duplicate hook' }, async () => { writes += 1; return {}; }, { resolvers: rejected.registry, checks: rejected.checks, generateEmbedding: async () => [0.9] });
    expect(blocked.artifact).toBeNull(); expect(writes).toBe(1);
  });
});
