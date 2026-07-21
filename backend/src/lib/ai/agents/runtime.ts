import { AiError } from '@/lib/ai/shared/result';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { agentSchema, getAgentById, type Agent } from '@/lib/db/agents.node';
import { listAgentSkillsByAgentKey, type AgentSkill } from '@/lib/db/agent-skills.node';
import { getSkillById, type Skill } from '@/lib/db/skills.node';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import type { Guardrail } from '@/lib/ai/guardrails';
import { getDefaultRuntimeVariableRepository, type RuntimeVariableRepository } from '@/lib/ai/runtime-variables';
import { getDefaultAgentMemoryRepository, type AgentMemory, type AgentMemoryRepository } from '@/lib/ai/agent-memories';
import { defaultArtifactResolverRegistry, resolveArtifactSources, type ArtifactReference, type ArtifactResolverRegistry, type SourcePermissionResolver } from '@/lib/ai/artifact-resolvers';
import type { SourceSelection } from '@/lib/ai/agent-run-sources';
import { emptyKnowledgePack } from '@/lib/ai/reverse-context/knowledge-pack';
import type { KnowledgePack } from '@/lib/ai/reverse-context/schema';
import type { ReverseContextCompiler } from '@/lib/ai/reverse-context/compiler';

export class AgentRuntimeNotFoundError extends AiError {
  constructor(entity: string, key: string) {
    super('agent_runtime_not_found', `${entity} not found while compiling agent runtime: ${key}`);
  }
}
export class AgentRuntimeInvalidError extends AiError {
  constructor(detail: string) { super('agent_runtime_invalid', `Invalid persisted agent runtime: ${detail}`); }
}

export interface LoadedAgentSkill { relation: AgentSkill; skill: Skill }
export interface AgentRuntimeContext {
  organization: Organization;
  agent: Agent;
  scope: Scope;
  skills: LoadedAgentSkill[];
}
export interface AgentRuntimeDataSource {
  getAgent(key: string): Promise<Agent | null>;
  getScope(key: string): Promise<Scope | null>;
  getOrganization(key: string): Promise<Organization | null>;
  listAgentSkills(agentKey: string): Promise<AgentSkill[]>;
  getSkill(key: string): Promise<Skill | null>;
}
const defaultDataSource: AgentRuntimeDataSource = {
  getAgent: getAgentById,
  getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
  getOrganization: getOrganizationById,
  listAgentSkills: listAgentSkillsByAgentKey,
  getSkill: getSkillById,
};

/** Loads the persisted identity and competence graph for one agent. */
export async function loadAgentRuntime(agentKey: string, source: AgentRuntimeDataSource = defaultDataSource): Promise<AgentRuntimeContext> {
  const validAgentKey = agentSchema.shape.key.parse(agentKey);
  const agent = await source.getAgent(validAgentKey);
  if (!agent) throw new AgentRuntimeNotFoundError('Agent', validAgentKey);
  // The agent registry record itself declares the home scope. Agents are
  // never assigned to scopes through a linking collection.
  const scope = await source.getScope(agent.scopeKey);
  if (!scope) throw new AgentRuntimeNotFoundError('Scope', agent.scopeKey);
  const organization = await source.getOrganization(scope.organizationKey);
  if (!organization) throw new AgentRuntimeNotFoundError('Organization', scope.organizationKey);

  const skillRelations = await source.listAgentSkills(agent.key);
  const skills = await Promise.all(skillRelations.map(async (relation) => {
    const skill = await source.getSkill(relation.skillKey);
    if (!skill) throw new AgentRuntimeNotFoundError('Skill', relation.skillKey);
    return { relation, skill };
  }));
  skills.sort((left, right) => right.relation.priority - left.relation.priority || left.relation.key.localeCompare(right.relation.key));
  if (skills.length === 0) throw new AgentRuntimeInvalidError(`agent ${agent.key} has no skills`);

  return { organization, agent, scope, skills };
}
export interface AgentSourcePolicy {
  requestedExplorationRate: number;
  effectiveExplorationRate: number;
  sourceCount: number;
}
export interface AgentKnowledge {
  pack: KnowledgePack;
  sources: readonly ArtifactReference[];
  memories: readonly AgentMemory[];
}
export interface AgentContext extends AgentRuntimeContext {
  variables: Readonly<Record<string, unknown>>;
  memories: readonly AgentMemory[];
  artifacts: readonly ArtifactReference[];
  knowledge: AgentKnowledge;
  guardrails: readonly Guardrail[];
  sourcePolicy: AgentSourcePolicy;
  currentTask: string;
}
export interface CompileAgentContextOptions {
  currentTask: string;
  sources?: readonly SourceSelection[];
  variables?: RuntimeVariableRepository;
  memories?: AgentMemoryRepository;
  artifactResolvers?: ArtifactResolverRegistry;
  canUseSource?: SourcePermissionResolver;
  reverseContextCompiler?: ReverseContextCompiler;
  knowledgeNodeTypes?: readonly string[];
  knowledgeTokenBudget?: number;
}

/** Compiles a fresh context. Agents receive this value and never query storage. */
export async function compileAgentContext(runtime: AgentRuntimeContext, options: CompileAgentContextOptions): Promise<AgentContext> {
  const currentTask = options.currentTask.trim();
  if (!currentTask) throw new AgentRuntimeInvalidError('current task is empty');
  const [loadedVariables, loadedMemories, artifacts, knowledgePack] = await Promise.all([
    (options.variables ?? getDefaultRuntimeVariableRepository()).listVariablesForContext(runtime.organization.key, runtime.scope.key, runtime.agent.key),
    (options.memories ?? getDefaultAgentMemoryRepository()).listMemoriesForAgent(runtime.agent.key),
    resolveArtifactSources({ organizationKey: runtime.organization.key, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, selections: options.sources ?? [], registry: options.artifactResolvers ?? defaultArtifactResolverRegistry, canUseSource: options.canUseSource }),
    options.reverseContextCompiler
      ? options.reverseContextCompiler.compile({ organizationKey: runtime.organization.key, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, query: currentTask, nodeTypes: options.knowledgeNodeTypes, manualSources: options.sources, tokenBudget: options.knowledgeTokenBudget })
      : Promise.resolve(emptyKnowledgePack(currentTask, options.knowledgeTokenBudget)),
  ]);
  const variables: Record<string, unknown> = {};
  for (const variable of loadedVariables) variables[variable.name] = variable.value;
  const memories = loadedMemories.filter((memory) => memory.organizationKey === runtime.organization.key && memory.scopeKey === runtime.scope.key);
  const guardrails = [{ scopeId: runtime.scope.key }];
  const sourceCount = artifacts.length;
  const knowledge = { pack: knowledgePack, sources: artifacts, memories };
  return { ...runtime, variables, memories, artifacts, knowledge, guardrails, sourcePolicy: { requestedExplorationRate: runtime.agent.explorationRate, effectiveExplorationRate: sourceCount === 0 ? 1 : runtime.agent.explorationRate, sourceCount }, currentTask };
}

export interface CompileAgentRuntimeOptions {
  outputSchema?: string;
  /**
   * 'metadata-json' (default) demands the structured output-metadata envelope
   * used by the persisted pipeline. 'user-text' is for streamed user-facing
   * answers: plain Markdown, no JSON envelope, nothing internal.
   */
  outputFormat?: 'metadata-json' | 'user-text';
}
/** Renders the structured context into the provider's system instructions. */
export function compileAgentRuntimeContext(context: AgentContext, options: CompileAgentRuntimeOptions = {}): string {
  const skillSections = context.skills.flatMap(({ relation, skill }) => [`### ${skill.title} (${skill.name}, priority ${relation.priority})`, skill.definition.trim()]);
  return [
    `# ${context.agent.name} — ${context.agent.title}`,
    '', '## Organization', `${context.organization.name} (${context.organization.key})`,
    '', '## Scope context', `${context.scope.name}: ${context.scope.description}`,
    '', '## Skills', ...skillSections,
    '', '## Variables', JSON.stringify(context.variables),
    '', '## Memories', JSON.stringify(context.memories.map(({ content, memoryType, importance }) => ({ content, memoryType, importance }))),
    '', '## Artifact sources', JSON.stringify(context.artifacts),
    '', '## Knowledge', JSON.stringify(context.knowledge),
    '', '## Guardrails', JSON.stringify(context.guardrails),
    '', '## Source policy', JSON.stringify(context.sourcePolicy),
    '', '## Output schema',
    ...(options.outputFormat === 'user-text'
      ? [
        'Respond with the user-facing answer as plain Markdown text.',
        'Do not wrap the answer in JSON and do not include output metadata, hidden reasoning, tool payloads, or internal runtime context.',
      ]
      : [
        'Every output must include metadata: { "status": "accepted" | "rejected", "reason": "at most ten words", "score": 0..1 }.',
        options.outputSchema?.trim() || 'Return the remaining schema required by the selected action.',
      ]),
    '', '## Current task', context.currentTask,
  ].join('\n');
}
