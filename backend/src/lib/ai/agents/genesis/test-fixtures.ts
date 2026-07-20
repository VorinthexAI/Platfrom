import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { toolSchema } from '@/lib/db/tools.node';
import { actionSchema } from '@/lib/db/actions.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import type { AgentRuntimeDataSource } from '@/lib/ai/agents';
import type { GenesisCatalogDataSource } from './context';

export function buildGenesisFixture() {
  const now = '2026-07-16T00:00:00.000Z';
  const organization = organizationSchema.parse({ key: newId(), name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'launch', name: 'Launch', summary: 'Build validated agents.', description: 'Build validated agents.', position: 2, embedding: [0, 1] });
  const genesis = agentSchema.parse({ key: newId(), slug: 'genesis', name: 'Genesis', title: 'Agent Architect', scopeKey: scope.key, explorationRate: 0.2, embedding: [0, 1] });
  const architect = skillSchema.parse({ key: newId(), slug: 'agent-architect', name: 'Agent Architecture', title: 'Agent Architect', definition: '# Agent Architect', embedding: [0, 1] });
  const backend = skillSchema.parse({ key: newId(), slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: '# Backend Developer', embedding: [0, 1] });
  const reasonTool = toolSchema.parse({ key: newId(), slug: 'reason.solve', name: 'Reason', description: 'Reason through agent architecture.', scopeKey: null, enabled: true, embedding: [0, 1] });
  const reasonAction = actionSchema.parse({ key: newId(), slug: 'reason', name: 'Reason', description: 'Reason', objective: 'Design', inputDescription: 'Request', outputDescription: 'Manifest', handlerKey: 'reason', enabled: true });
  const createTool = toolSchema.parse({ key: newId(), slug: 'agent.create', name: 'Create Agent', description: 'Create a validated agent architecture.', scopeKey: null, enabled: true, embedding: [0, 1] });
  const createAction = actionSchema.parse({ key: newId(), slug: 'insert', name: 'Insert', description: 'Persist a node', objective: 'Persist architecture', inputDescription: 'Node', outputDescription: 'Created node', handlerKey: 'insert', enabled: true });
  const skillLink = agentSkillSchema.parse({ key: newId(), agentKey: genesis.key, skillKey: architect.key, priority: 100 });
  const toolLink = agentToolSchema.parse({ key: newId(), agentKey: genesis.key, toolKey: createTool.key });
  const actionLink = toolActionSchema.parse({ key: newId(), toolKey: createTool.key, actionKey: createAction.key, priority: 100, enabled: true });
  const runtimeData: AgentRuntimeDataSource = {
    async getAgent(key) { return key === genesis.key ? genesis : null; }, async getScope(key) { return key === scope.key ? scope : null; }, async getOrganization(key) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [skillLink]; }, async getSkill(key) { return key === architect.key ? architect : null; },
    async listAgentTools() { return [toolLink]; }, async getTool(key) { return key === createTool.key ? createTool : null; },
    async listToolActions() { return [actionLink]; }, async getAction(key) { return key === createAction.key ? createAction : null; },
  };
  const catalog: GenesisCatalogDataSource = {
    async listOrganizationScopes() { return [scope]; }, async listAgents() { return [genesis]; }, async listSkills() { return [architect, backend]; }, async listTools() { return [createTool, reasonTool]; },
  };
  const variables = { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return []; } };
  const memories = { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return []; } };
  const generateEmbedding = async () => [0, 1] as const;
  return { now, organization, scope, genesis, architect, backend, reasonTool, reasonAction, createTool, createAction, runtimeData, catalog, variables, memories, generateEmbedding };
}
