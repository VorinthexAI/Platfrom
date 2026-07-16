import { AiError } from '@/lib/ai/shared/result';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { getActionById, type Action } from '@/lib/db/actions.node';
import { agentSchema, getAgentById, type Agent } from '@/lib/db/agents.node';
import { listAgentSkillsByAgentKey, type AgentSkill } from '@/lib/db/agent-skills.node';
import { listAgentToolsByAgentKey, type AgentTool } from '@/lib/db/agent-tools.node';
import { getSkillById, type Skill } from '@/lib/db/skills.node';
import { listToolActionsByToolKey, type ToolAction } from '@/lib/db/tool-actions.node';
import { getToolById, type Tool } from '@/lib/db/tools.node';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { assertToolAllowedByGuardrails, type Guardrail } from '@/lib/ai/guardrails';
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
export interface LoadedAgentTool {
  relation: AgentTool;
  tool: Tool;
  actions: Array<{ relation: ToolAction; action: Action }>;
}
export interface AgentRuntimeContext {
  organization: Organization;
  agent: Agent;
  scope: Scope;
  skills: LoadedAgentSkill[];
  tools: LoadedAgentTool[];
}
export interface AgentRuntimeDataSource {
  getAgent(key: string): Promise<Agent | null>;
  getScope(key: string): Promise<Scope | null>;
  getOrganization(key: string): Promise<Organization | null>;
  listAgentSkills(agentKey: string): Promise<AgentSkill[]>;
  getSkill(key: string): Promise<Skill | null>;
  listAgentTools(agentKey: string): Promise<AgentTool[]>;
  getTool(key: string): Promise<Tool | null>;
  listToolActions(toolKey: string): Promise<ToolAction[]>;
  getAction(key: string): Promise<Action | null>;
}
const defaultDataSource: AgentRuntimeDataSource = {
  getAgent: getAgentById,
  getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
  getOrganization: getOrganizationById,
  listAgentSkills: listAgentSkillsByAgentKey,
  getSkill: getSkillById,
  listAgentTools: listAgentToolsByAgentKey,
  getTool: getToolById,
  listToolActions: listToolActionsByToolKey,
  getAction: getActionById,
};

/** Loads the complete persisted authorization and competence graph for one agent. */
export async function loadAgentRuntime(agentKey: string, source: AgentRuntimeDataSource = defaultDataSource): Promise<AgentRuntimeContext> {
  const validAgentKey = agentSchema.shape.key.parse(agentKey);
  const agent = await source.getAgent(validAgentKey);
  if (!agent) throw new AgentRuntimeNotFoundError('Agent', validAgentKey);
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

  const toolRelations = await source.listAgentTools(agent.key);
  const tools = await Promise.all(toolRelations.map(async (relation) => {
    const tool = await source.getTool(relation.toolKey);
    if (!tool) throw new AgentRuntimeNotFoundError('Tool', relation.toolKey);
    if (!tool.enabled) throw new AgentRuntimeInvalidError(`agent ${agent.key} is linked to disabled tool ${tool.key}`);
    assertToolAllowedByGuardrails(agent.key, [{ scopeId: agent.scopeKey }], { id: tool.slug, scopeId: tool.scopeKey });
    const actionRelations = (await source.listToolActions(tool.key)).filter((link) => link.enabled);
    actionRelations.sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key));
    const actions = await Promise.all(actionRelations.map(async (actionRelation) => {
      const action = await source.getAction(actionRelation.actionKey);
      if (!action) throw new AgentRuntimeNotFoundError('Action', actionRelation.actionKey);
      if (!action.enabled) throw new AgentRuntimeInvalidError(`tool ${tool.key} uses disabled action ${action.key}`);
      return { relation: actionRelation, action };
    }));
    if (actions.length === 0) throw new AgentRuntimeInvalidError(`tool ${tool.key} has no enabled actions`);
    return { relation, tool, actions };
  }));
  return { organization, agent, scope, skills, tools };
}

export interface AgentPermission {
  toolKey: string;
  toolSlug: string;
  actionKeys: readonly string[];
  actionSlugs: readonly string[];
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
  permissions: readonly AgentPermission[];
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
  const permissions = runtime.tools.map(({ tool, actions }) => ({ toolKey: tool.key, toolSlug: tool.slug, actionKeys: actions.map(({ action }) => action.key), actionSlugs: actions.map(({ action }) => action.slug) }));
  const guardrails = [{ scopeId: runtime.scope.key }];
  const sourceCount = artifacts.length;
  const knowledge = { pack: knowledgePack, sources: artifacts, memories };
  return { ...runtime, variables, memories, artifacts, knowledge, permissions, guardrails, sourcePolicy: { requestedExplorationRate: runtime.agent.explorationRate, effectiveExplorationRate: sourceCount === 0 ? 1 : runtime.agent.explorationRate, sourceCount }, currentTask };
}

export interface CompileAgentRuntimeOptions { outputSchema?: string }
/** Renders the structured context into the provider's system instructions. */
export function compileAgentRuntimeContext(context: AgentContext, options: CompileAgentRuntimeOptions = {}): string {
  const skillSections = context.skills.flatMap(({ relation, skill }) => [`### ${skill.title} (${skill.name}, priority ${relation.priority})`, skill.definition.trim()]);
  const toolLines = context.tools.map(({ tool, actions }) => `- ${tool.slug} — ${tool.name}: ${tool.description} [${actions.map(({ action }) => action.slug).join(', ')}]`);
  return [
    `# ${context.agent.name} — ${context.agent.title}`,
    '', '## Organization', `${context.organization.name} (${context.organization.key})`,
    '', '## Scope context', `${context.scope.name}: ${context.scope.description}`,
    '', '## Skills', ...skillSections,
    '', '## Available tools', ...toolLines,
    '', '## Variables', JSON.stringify(context.variables),
    '', '## Memories', JSON.stringify(context.memories.map(({ content, memoryType, importance }) => ({ content, memoryType, importance }))),
    '', '## Artifact sources', JSON.stringify(context.artifacts),
    '', '## Knowledge', JSON.stringify(context.knowledge),
    '', '## Permissions', JSON.stringify(context.permissions),
    '', '## Guardrails', JSON.stringify(context.guardrails),
    '', '## Source policy', JSON.stringify(context.sourcePolicy),
    '', '## Output schema', 'Every output must include metadata: { "status": "accepted" | "rejected", "reason": "at most ten words", "score": 0..1 }.',
    options.outputSchema?.trim() || 'Return the remaining schema required by the selected action.',
    '', '## Current task', context.currentTask,
  ].join('\n');
}
