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
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'agent-builder', name: 'Agent Builder', description: 'Build validated agents.' });
  const genesis = agentSchema.parse({ key: newId(), slug: 'genesis', name: 'Genesis', title: 'Agent Architect', scopeKey: scope.key, explorationRate: 0.2, embedding: [0, 1] });
  const architect = skillSchema.parse({ key: newId(), slug: 'agent-architect', name: 'Agent Architecture', title: 'Agent Architect', definition: '# Agent Architect', embedding: [0, 1] });
  const backend = skillSchema.parse({ key: newId(), slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: '# Backend Developer', embedding: [0, 1] });
  const reasonTool = toolSchema.parse({ key: newId(), slug: 'reason.solve', name: 'Reason', description: 'Reason through agent architecture.', scopeKey: null, enabled: true });
  const reasonAction = actionSchema.parse({ key: newId(), slug: 'core.reason', name: 'Reason', description: 'Reason', objective: 'Design', inputDescription: 'Request', outputDescription: 'Manifest', handlerKey: 'core.reason', enabled: true });
  const skillLink = agentSkillSchema.parse({ key: newId(), agentKey: genesis.key, skillKey: architect.key, priority: 100 });
  const toolLink = agentToolSchema.parse({ key: newId(), agentKey: genesis.key, toolKey: reasonTool.key });
  const actionLink = toolActionSchema.parse({ key: newId(), toolKey: reasonTool.key, actionKey: reasonAction.key, priority: 100, enabled: true });
  const runtimeData: AgentRuntimeDataSource = {
    async getAgent(key) { return key === genesis.key ? genesis : null; }, async getScope(key) { return key === scope.key ? scope : null; }, async getOrganization(key) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [skillLink]; }, async getSkill(key) { return key === architect.key ? architect : null; },
    async listAgentTools() { return [toolLink]; }, async getTool(key) { return key === reasonTool.key ? reasonTool : null; },
    async listToolActions() { return [actionLink]; }, async getAction(key) { return key === reasonAction.key ? reasonAction : null; },
  };
  const catalog: GenesisCatalogDataSource = {
    async listOrganizationScopes() { return [scope]; }, async listAgents() { return [genesis]; }, async listSkills() { return [architect, backend]; }, async listTools() { return [reasonTool]; },
  };
  const variables = { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return []; } };
  const memories = { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return []; } };
  return { now, organization, scope, genesis, architect, backend, reasonTool, reasonAction, runtimeData, catalog, variables, memories };
}
