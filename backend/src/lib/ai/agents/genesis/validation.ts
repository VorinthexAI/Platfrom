import { AiError } from '@/lib/ai/shared/result';
import { newId } from '@/lib/ids';
import { embed } from '@/lib/embed';
import { ArtifactResolverRegistry, type ArtifactResolver, type OwnedArtifactReference, type SimilarArtifact } from '@/lib/ai/artifact-resolvers';
import { checkArtifactNovelty, SimilarityPolicyRegistry, getDefaultAgentArtifactCheckRepository, type AgentArtifactCheckRepository, type NoveltyValidator } from '@/lib/ai/agent-artifact-checks';
import type { Agent } from '@/lib/db/agents.node';
import type { Skill } from '@/lib/db/skills.node';
import type { Tool } from '@/lib/db/tools.node';
import type { GenesisContext } from './context';
import { GENESIS_STEP_SLUGS, genesisCreationManifestSchema, type GenesisCreationManifest } from './schemas';

export const GENESIS_NOVELTY_POLICIES = {
  agent: { reviewThreshold: 0.85, rejectThreshold: 0.95, comparisonLimit: 5 },
  skill: { reviewThreshold: 0.80, rejectThreshold: 0.90, comparisonLimit: 5 },
} as const;

export class GenesisManifestReferenceError extends AiError {
  constructor(entity: string, key: string) { super('genesis_reference_invalid', `${entity} reference does not exist or is inaccessible: ${key}`); }
}
export class GenesisManifestConsistencyError extends AiError {
  constructor(detail: string) { super('genesis_manifest_inconsistent', `Genesis manifest is inconsistent: ${detail}`); }
}
export class GenesisNoveltyReviewError extends AiError {
  constructor(nodeType: string, slug: string) { super('genesis_novelty_review_required', `${nodeType} ${slug} requires semantic review`); }
}

export interface GenesisCreationPlan {
  agentKey: string | null;
  agentEmbedding: readonly number[] | null;
  skills: Readonly<Record<string, { key: string; embedding: readonly number[] }>>;
}
export interface ValidatedGenesisManifest {
  manifest: GenesisCreationManifest;
  plan: GenesisCreationPlan;
}
export interface ValidateGenesisManifestOptions {
  checks?: AgentArtifactCheckRepository;
  generateEmbedding?: (text: string) => Promise<readonly number[]>;
  semanticReviewer?: NoveltyValidator;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0; const b = right[index] ?? 0;
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function similarityResolver(
  nodeType: 'agent' | 'skill',
  organizationKey: string,
  nodes: readonly (Agent | Skill)[],
  forcedKey?: string,
): ArtifactResolver {
  const references = new Map<string, OwnedArtifactReference>();
  for (const node of nodes) references.set(node.key, {
    nodeType,
    nodeKey: node.key,
    organizationKey,
    scopeKey: 'scopeKey' in node ? node.scopeKey : null,
    name: node.name,
    summary: node.title,
  });
  return {
    async exists(key) { return references.has(key); },
    async getReference(key) { return references.get(key) ?? null; },
    async getContent(key) { return nodes.find((node) => node.key === key) ?? null; },
    async findSimilar(candidateEmbedding, limit) {
      const values: SimilarArtifact[] = nodes.map((node) => ({
        reference: references.get(node.key)!,
        similarity: node.key === forcedKey ? 1 : cosineSimilarity(candidateEmbedding, node.embedding),
      }));
      return values.sort((left, right) => right.similarity - left.similarity || left.reference.nodeKey.localeCompare(right.reference.nodeKey)).slice(0, limit);
    },
  };
}

function assertStableSteps(manifest: GenesisCreationManifest) {
  if (manifest.steps.length !== GENESIS_STEP_SLUGS.length || manifest.steps.some((step, index) => step !== GENESIS_STEP_SLUGS[index])) {
    throw new GenesisManifestConsistencyError('steps must contain the complete stable workflow in order');
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new GenesisManifestConsistencyError(`${label} contains duplicates`);
}

/** Parses model output, resolves every key, and applies backend-owned reuse and novelty policy. */
export async function validateGenesisManifest(
  rawManifest: unknown,
  context: GenesisContext,
  agentRunKey: string,
  options: ValidateGenesisManifestOptions = {},
): Promise<ValidatedGenesisManifest> {
  const parsed = genesisCreationManifestSchema.parse(rawManifest);
  assertStableSteps(parsed);
  if (parsed.metadata.status === 'rejected') {
    return { manifest: genesisCreationManifestSchema.parse({ ...parsed, validation: { ...parsed.validation, readyToPersist: false } }), plan: { agentKey: null, agentEmbedding: null, skills: {} } };
  }
  if (parsed.validation.missingToolSlugs.length > 0) throw new GenesisManifestConsistencyError('accepted manifest declares missing tools');

  const checks = options.checks ?? getDefaultAgentArtifactCheckRepository();
  const generateEmbedding = options.generateEmbedding ?? (async (text: string) => embed({ text }));
  const policies = new SimilarityPolicyRegistry()
    .register('agent', {
      reviewThreshold: GENESIS_NOVELTY_POLICIES.agent.reviewThreshold,
      rejectThreshold: GENESIS_NOVELTY_POLICIES.agent.rejectThreshold,
    })
    .register('skill', {
      reviewThreshold: GENESIS_NOVELTY_POLICIES.skill.reviewThreshold,
      rejectThreshold: GENESIS_NOVELTY_POLICIES.skill.rejectThreshold,
    });
  const agents = context.knowledge.existingAgents;
  const skills = context.knowledge.existingSkills;
  const tools = context.knowledge.existingTools;
  const agentsByKey = new Map(agents.map((agent) => [agent.key, agent]));
  const agentsBySlug = new Map(agents.map((agent) => [agent.slug, agent]));
  const skillsByKey = new Map(skills.map((skill) => [skill.key, skill]));
  const skillsBySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  const toolsByKey = new Map(tools.map((tool) => [tool.key, tool]));

  let agentOperation = parsed.agent;
  let agentKey: string | null = null;
  let agentEmbedding: readonly number[] | null = null;
  if (agentOperation.operation === 'reuse') {
    const existing = agentsByKey.get(agentOperation.agentKey);
    if (!existing || existing.scopeKey !== context.scope.key) throw new GenesisManifestReferenceError('agent', agentOperation.agentKey);
    if (existing.slug === 'beacon') throw new GenesisManifestConsistencyError('the canonical Beacon agent cannot be modified by Genesis');
  } else {
    if (agentOperation.slug === 'beacon') throw new GenesisManifestConsistencyError('the canonical Beacon agent cannot be created or modified by Genesis');
    // Genesis owns one canonical execution scope. Model output cannot choose
    // where a newly created agent is deployed.
    agentOperation = { ...agentOperation, scopeKey: context.scope.key };
    agentKey = newId();
    const exact = agentsBySlug.get(agentOperation.slug);
    const registry = new ArtifactResolverRegistry().register('agent', similarityResolver('agent', context.organization.key, agents, exact?.key));
    const result = await checkArtifactNovelty({ agentRunKey, candidateNodeType: 'agent', candidateNodeKey: agentKey, candidateText: [agentOperation.name, agentOperation.title].join('\n\n'), limit: GENESIS_NOVELTY_POLICIES.agent.comparisonLimit }, { resolvers: registry, policies, checks, validator: options.semanticReviewer, generateEmbedding });
    agentEmbedding = result.embedding;
    if (result.decision === 'rejected') {
      const comparedKey = result.checks[0]?.comparedNodeKey;
      const duplicate = comparedKey ? agentsByKey.get(comparedKey) : undefined;
      if (!duplicate || duplicate.scopeKey !== context.scope.key) throw new GenesisManifestConsistencyError(`duplicate agent ${agentOperation.slug} cannot be reused in this scope`);
      agentOperation = { operation: 'reuse', agentKey: duplicate.key };
      agentKey = null; agentEmbedding = null;
    } else if (result.decision === 'revised') {
      throw new GenesisNoveltyReviewError('agent', agentOperation.slug);
    }
  }

  assertUnique(parsed.skills.map((operation) => operation.operation === 'reuse' ? `key:${operation.skillKey}` : `slug:${operation.slug}`), 'skills');
  const createdPlans: Record<string, { key: string; embedding: readonly number[] }> = {};
  const replacements = new Map<string, Skill>();
  const validatedSkills: GenesisCreationManifest['skills'] = [];
  for (const operation of parsed.skills) {
    if (operation.operation === 'reuse') {
      if (!skillsByKey.has(operation.skillKey)) throw new GenesisManifestReferenceError('skill', operation.skillKey);
      validatedSkills.push(operation);
      continue;
    }
    const candidateKey = newId();
    const exact = skillsBySlug.get(operation.slug);
    const registry = new ArtifactResolverRegistry().register('skill', similarityResolver('skill', context.organization.key, skills, exact?.key));
    const result = await checkArtifactNovelty({ agentRunKey, candidateNodeType: 'skill', candidateNodeKey: candidateKey, candidateText: [operation.name, operation.title, operation.definition].join('\n\n'), limit: GENESIS_NOVELTY_POLICIES.skill.comparisonLimit }, { resolvers: registry, policies, checks, validator: options.semanticReviewer, generateEmbedding });
    if (result.decision === 'rejected') {
      const comparedKey = result.checks[0]?.comparedNodeKey;
      const duplicate = comparedKey ? skillsByKey.get(comparedKey) : undefined;
      if (!duplicate) throw new GenesisManifestConsistencyError(`duplicate skill ${operation.slug} cannot be resolved`);
      replacements.set(operation.slug, duplicate);
      validatedSkills.push({ operation: 'reuse', skillKey: duplicate.key, priority: operation.priority });
    } else if (result.decision === 'revised') {
      throw new GenesisNoveltyReviewError('skill', operation.slug);
    } else {
      createdPlans[operation.slug] = { key: candidateKey, embedding: result.embedding };
      validatedSkills.push(operation);
    }
  }

  const validatedAgentSkills = parsed.agentSkills.map((relation) => {
    if (relation.skillRef.type === 'existing') {
      if (!skillsByKey.has(relation.skillRef.skillKey)) throw new GenesisManifestReferenceError('skill', relation.skillRef.skillKey);
      return relation;
    }
    const replacement = replacements.get(relation.skillRef.skillSlug);
    if (replacement) return { ...relation, skillRef: { type: 'existing' as const, skillKey: replacement.key } };
    if (!createdPlans[relation.skillRef.skillSlug]) throw new GenesisManifestReferenceError('created skill', relation.skillRef.skillSlug);
    return relation;
  });
  const skillIdentities = validatedSkills.map((operation) => operation.operation === 'reuse' ? `key:${operation.skillKey}` : `slug:${operation.slug}`);
  const relationIdentities = validatedAgentSkills.map((relation) => relation.skillRef.type === 'existing' ? `key:${relation.skillRef.skillKey}` : `slug:${relation.skillRef.skillSlug}`);
  assertUnique(skillIdentities, 'validated skills');
  assertUnique(relationIdentities, 'agentSkills');
  if (skillIdentities.length !== relationIdentities.length || skillIdentities.some((identity) => !relationIdentities.includes(identity))) {
    throw new GenesisManifestConsistencyError('every skill operation must have exactly one agentSkills relation');
  }

  assertUnique(parsed.agentTools.map((operation) => operation.toolKey), 'agentTools');
  for (const operation of parsed.agentTools) {
    const tool: Tool | undefined = toolsByKey.get(operation.toolKey);
    if (!tool || !tool.enabled) throw new GenesisManifestReferenceError('tool', operation.toolKey);
    if (tool.slug === 'core.delegate') throw new GenesisManifestReferenceError('Beacon-only tool', operation.toolKey);
    if (tool.scopeKey !== null && tool.scopeKey !== context.scope.key) throw new GenesisManifestReferenceError('tool permission', operation.toolKey);
  }

  const manifest = genesisCreationManifestSchema.parse({
    ...parsed,
    agent: agentOperation,
    skills: validatedSkills,
    agentSkills: validatedAgentSkills,
    validation: {
      ...parsed.validation,
      scopeExists: true,
      agentIsUnique: true,
      allSkillsResolved: true,
      allToolsResolved: true,
      permissionsValid: true,
      noveltyValidated: true,
      readyToPersist: true,
      missingToolSlugs: [],
    },
  });
  return { manifest, plan: { agentKey, agentEmbedding, skills: createdPlans } };
}
