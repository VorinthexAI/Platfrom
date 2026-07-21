import { z } from 'zod';
import { embedText } from '@/lib/bedrock-titan';
import { AiError } from '@/lib/ai/shared/result';
import { nodeTypeSchema } from '@/lib/ai/agent-run-sources';
import { type ArtifactResolverRegistry, defaultArtifactResolverRegistry } from '@/lib/ai/artifact-resolvers';
import { AGENT_ARTIFACT_CHECK_DECISIONS, type AgentArtifactCheck } from './schema';
import { getDefaultAgentArtifactCheckRepository, type AgentArtifactCheckRepository } from './repository';

export const similarityPolicySchema = z.object({
  reviewThreshold: z.number().min(-1).max(1),
  rejectThreshold: z.number().min(-1).max(1),
}).strict().refine((policy) => policy.reviewThreshold < policy.rejectThreshold, { message: 'reviewThreshold must be below rejectThreshold' });
export type SimilarityPolicy = z.infer<typeof similarityPolicySchema>;

export class SimilarityPolicyRegistry {
  readonly #policies = new Map<string, SimilarityPolicy>();
  register(nodeType: string, policy: SimilarityPolicy): this {
    this.#policies.set(nodeTypeSchema.parse(nodeType), similarityPolicySchema.parse(policy));
    return this;
  }
  get(nodeType: string): SimilarityPolicy {
    const type = nodeTypeSchema.parse(nodeType);
    const policy = this.#policies.get(type);
    if (!policy) throw new AiError('similarity_policy_not_found', `No similarity policy is registered for ${type}`);
    return policy;
  }
}

export const defaultSimilarityPolicyRegistry = new SimilarityPolicyRegistry()
  .register('hook', { reviewThreshold: 0.80, rejectThreshold: 0.90 })
  .register('image', { reviewThreshold: 0.88, rejectThreshold: 0.96 })
  .register('blog-post', { reviewThreshold: 0.82, rejectThreshold: 0.94 });

export type NoveltyDecision = typeof AGENT_ARTIFACT_CHECK_DECISIONS[number];
export interface NoveltyValidatorInput {
  candidateNodeType: string;
  candidateNodeKey: string;
  candidateText: string;
  comparedNodeType: string;
  comparedNodeKey: string;
  similarity: number;
}
export type NoveltyValidator = (input: NoveltyValidatorInput) => Promise<{ decision: NoveltyDecision; reason: string }>;
export interface CheckArtifactNoveltyInput {
  agentRunKey: string;
  candidateNodeType: string;
  candidateNodeKey: string;
  candidateText: string;
  limit?: number;
}
export interface CheckArtifactNoveltyOptions {
  resolvers?: ArtifactResolverRegistry;
  policies?: SimilarityPolicyRegistry;
  checks?: AgentArtifactCheckRepository;
  validator?: NoveltyValidator;
  generateEmbedding?: (text: string) => Promise<readonly number[]>;
}
export interface NoveltyResult {
  decision: NoveltyDecision;
  reason: string;
  embedding: readonly number[];
  checks: readonly AgentArtifactCheck[];
}

/** Checks novelty before domain persistence; callers persist only accepted candidates. */
export async function checkArtifactNovelty(input: CheckArtifactNoveltyInput, options: CheckArtifactNoveltyOptions = {}): Promise<NoveltyResult> {
  const parsed = z.object({
    agentRunKey: z.string().cuid(), candidateNodeType: nodeTypeSchema, candidateNodeKey: z.string().cuid(),
    candidateText: z.string().trim().min(1), limit: z.number().int().min(1).max(100).default(10),
  }).strict().parse(input);
  const registry = options.resolvers ?? defaultArtifactResolverRegistry;
  const policy = (options.policies ?? defaultSimilarityPolicyRegistry).get(parsed.candidateNodeType);
  const embedding = await (options.generateEmbedding ?? (async (text) => embedText({ text })))(parsed.candidateText);
  const similar = [...await registry.get(parsed.candidateNodeType).findSimilar(embedding, parsed.limit)]
    .filter((match) => match.reference.nodeKey !== parsed.candidateNodeKey)
    .sort((left, right) => right.similarity - left.similarity);
  const top = similar[0];
  if (!top) {
    return { decision: 'accepted', reason: 'No similar artifacts found', embedding, checks: [] };
  }
  if (top.similarity < policy.reviewThreshold) {
    const reason = 'Below review threshold';
    const check = await (options.checks ?? getDefaultAgentArtifactCheckRepository()).insertCheck({
      agentRunKey: parsed.agentRunKey, candidateNodeType: parsed.candidateNodeType, candidateNodeKey: parsed.candidateNodeKey,
      comparedNodeType: top.reference.nodeType, comparedNodeKey: top.reference.nodeKey, similarity: top.similarity, decision: 'accepted', reason,
    });
    return { decision: 'accepted', reason, embedding, checks: [check] };
  }

  let decision: NoveltyDecision;
  let reason: string;
  if (top.similarity >= policy.rejectThreshold) {
    decision = 'rejected';
    reason = 'Similarity meets reject threshold';
  } else if (options.validator) {
    ({ decision, reason } = await options.validator({ candidateNodeType: parsed.candidateNodeType, candidateNodeKey: parsed.candidateNodeKey, candidateText: parsed.candidateText, comparedNodeType: top.reference.nodeType, comparedNodeKey: top.reference.nodeKey, similarity: top.similarity }));
  } else {
    decision = 'revised';
    reason = 'Similarity requires revision or validation';
  }
  const check = await (options.checks ?? getDefaultAgentArtifactCheckRepository()).insertCheck({
    agentRunKey: parsed.agentRunKey,
    candidateNodeType: parsed.candidateNodeType,
    candidateNodeKey: parsed.candidateNodeKey,
    comparedNodeType: top.reference.nodeType,
    comparedNodeKey: top.reference.nodeKey,
    similarity: top.similarity,
    decision,
    reason,
  });
  return { decision, reason, embedding, checks: [check] };
}

export interface PersistNovelArtifactResult<TArtifact> extends NoveltyResult { artifact: TArtifact | null }
/** Runs the universal novelty gate and invokes domain persistence only when accepted. */
export async function persistArtifactIfNovel<TArtifact>(
  input: CheckArtifactNoveltyInput,
  persist: (embedding: readonly number[]) => Promise<TArtifact>,
  options: CheckArtifactNoveltyOptions = {},
): Promise<PersistNovelArtifactResult<TArtifact>> {
  const result = await checkArtifactNovelty(input, options);
  return { ...result, artifact: result.decision === 'accepted' ? await persist(result.embedding) : null };
}
