import { AiError } from '@/lib/ai/shared/result';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { getActionById, type Action } from '@/lib/db/actions.node';
import { agentSchema, getAgentById, type Agent } from '@/lib/db/agents.node';
import { listAgentSkillsByAgentKey, type AgentSkill } from '@/lib/db/agent-skills.node';
import { listAgentToolsByAgentKey, type AgentTool } from '@/lib/db/agent-tools.node';
import { getSkillById, type Skill } from '@/lib/db/skills.node';
import { listToolActionsByToolKey, type ToolAction } from '@/lib/db/tool-actions.node';
import { getToolById, type Tool } from '@/lib/db/tools.node';
import { assertToolAllowedByGuardrails } from '@/lib/ai/guardrails';

export class AgentRuntimeNotFoundError extends AiError {
  constructor(entity: string, key: string) {
    super('agent_runtime_not_found', `${entity} not found while compiling agent runtime: ${key}`);
  }
}

export class AgentRuntimeInvalidError extends AiError {
  constructor(detail: string) {
    super('agent_runtime_invalid', `Invalid persisted agent runtime: ${detail}`);
  }
}

export interface LoadedAgentSkill { relation: AgentSkill; skill: Skill }
export interface LoadedAgentTool {
  relation: AgentTool;
  tool: Tool;
  actions: Array<{ relation: ToolAction; action: Action }>;
}
export interface AgentRuntimeContext {
  agent: Agent;
  scope: Scope;
  skills: LoadedAgentSkill[];
  tools: LoadedAgentTool[];
}

export interface AgentRuntimeDataSource {
  getAgent(key: string): Promise<Agent | null>;
  getScope(key: string): Promise<Scope | null>;
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
    const actionRelations = await source.listToolActions(tool.key);
    const actions = await Promise.all(actionRelations.map(async (actionRelation) => {
      const action = await source.getAction(actionRelation.actionKey);
      if (!action) throw new AgentRuntimeNotFoundError('Action', actionRelation.actionKey);
      if (!action.enabled) throw new AgentRuntimeInvalidError(`tool ${tool.key} uses disabled action ${action.key}`);
      return { relation: actionRelation, action };
    }));
    if (actions.length === 0) throw new AgentRuntimeInvalidError(`tool ${tool.key} has no enabled actions`);
    return { relation, tool, actions };
  }));

  return { agent, scope, skills, tools };
}

export interface CompileAgentRuntimeOptions { currentTask?: string; outputSchema?: string }

/** Deterministically compiles identity + scope + ordered skills + permissions. */
export function compileAgentRuntimeContext(runtime: AgentRuntimeContext, options: CompileAgentRuntimeOptions = {}): string {
  const skillSections = runtime.skills.flatMap(({ relation, skill }) => [
    `### ${skill.title} (${skill.name}, priority ${relation.priority})`,
    skill.definition.trim(),
  ]);
  const toolLines = runtime.tools.map(({ tool, actions }) =>
    `- ${tool.slug} — ${tool.name}: ${tool.description} [${actions.map(({ action }) => action.slug).join(', ')}]`,
  );

  return [
    `# ${runtime.agent.name} — ${runtime.agent.title}`,
    '', '## Scope context', `${runtime.scope.name}: ${runtime.scope.description}`,
    '', '## Guardrails', JSON.stringify({ scopeId: runtime.agent.scopeKey }),
    '', '## Skills', ...skillSections,
    '', '## Available tools and permissions', ...toolLines,
    '', '## Output schema',
    'Every output must include metadata: { "status": "accepted" | "rejected", "reason": "at most ten words", "score": 0..1 }.',
    options.outputSchema?.trim() || 'Return the remaining schema required by the selected action.',
    '', '## Current task', options.currentTask?.trim() || 'Complete the current request.',
  ].join('\n');
}
