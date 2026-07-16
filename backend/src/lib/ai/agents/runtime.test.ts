import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { actionSchema } from '@/lib/db/actions.node';
import { agentSchema } from '@/lib/db/agents.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { skillSchema } from '@/lib/db/skills.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import { toolSchema } from '@/lib/db/tools.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { GuardrailViolationError } from '@/lib/ai/guardrails';
import { compileAgentRuntimeContext, loadAgentRuntime, type AgentRuntimeDataSource } from './runtime';

const keys = { organization: newId(), scope: newId(), agent: newId(), backend: newId(), devops: newId(), tool: newId(), action: newId(), backendLink: newId(), devopsLink: newId(), agentTool: newId(), toolAction: newId() };
const agent = agentSchema.parse({ key: keys.agent, slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: keys.scope });
const scope = scopeSchema.parse({ key: keys.scope, organizationKey: keys.organization, slug: 'platform', name: 'Platform', description: 'Backend platform workspace.' });
const backend = skillSchema.parse({ key: keys.backend, slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: 'Build reliable backend services.' });
const devops = skillSchema.parse({ key: keys.devops, slug: 'devops-engineer', name: 'DevOps', title: 'DevOps Engineer', definition: 'Operate reliable infrastructure.' });
const tool = toolSchema.parse({ key: keys.tool, slug: 'reason.solve', name: 'Reason', description: 'Solve hard engineering problems.' });
const action = actionSchema.parse({ key: keys.action, slug: 'core.reason', name: 'Reason', description: 'Reason through a problem.', objective: 'Solve it.', inputDescription: 'A problem.', outputDescription: 'A solution.', handlerKey: 'core.reason' });
function source(): AgentRuntimeDataSource {
  return {
    async getAgent(key) { return key === agent.key ? agent : null; }, async getScope(key) { return key === scope.key ? scope : null; },
    async listAgentSkills() { return [agentSkillSchema.parse({ key: keys.devopsLink, agentKey: agent.key, skillKey: devops.key, priority: 90 }), agentSkillSchema.parse({ key: keys.backendLink, agentKey: agent.key, skillKey: backend.key, priority: 100 })]; },
    async getSkill(key) { return key === backend.key ? backend : key === devops.key ? devops : null; },
    async listAgentTools() { return [agentToolSchema.parse({ key: keys.agentTool, agentKey: agent.key, toolKey: tool.key })]; }, async getTool(key) { return key === tool.key ? tool : null; },
    async listToolActions() { return [toolActionSchema.parse({ key: keys.toolAction, toolKey: tool.key, actionKey: action.key })]; }, async getAction(key) { return key === action.key ? action : null; },
  };
}
describe('persisted agent runtime', () => {
  test('loads skills by descending priority and tools through explicit permissions', async () => {
    const runtime = await loadAgentRuntime(agent.key, source());
    expect(runtime.skills.map(({ skill }) => skill.slug)).toEqual(['backend-developer', 'devops-engineer']);
    expect(runtime.tools[0]?.actions[0]?.action.slug).toBe('core.reason');
  });
  test('compiles identity, effective scope guardrail, skills, permissions, schema and task', async () => {
    const compiled = compileAgentRuntimeContext(await loadAgentRuntime(agent.key, source()), { currentTask: 'Diagnose the production API.', outputSchema: '{ "status": "string" }' });
    expect(compiled.indexOf('priority 100')).toBeLessThan(compiled.indexOf('priority 90'));
    expect(compiled).toContain('# Forge — Backend Developer');
    expect(compiled).toContain(JSON.stringify({ scopeId: scope.key }));
    expect(compiled).toContain('reason.solve');
    expect(compiled).toContain('core.reason');
    expect(compiled).toContain('at most ten words');
  });
  test('rejects agents without skills', async () => { const empty = source(); empty.listAgentSkills = async () => []; await expect(loadAgentRuntime(agent.key, empty)).rejects.toThrow('has no skills'); });
  test('rejects a granted tool scoped outside the agent scope', async () => {
    const mismatched = source();
    mismatched.getTool = async () => toolSchema.parse({ ...tool, scopeKey: newId() });
    await expect(loadAgentRuntime(agent.key, mismatched)).rejects.toBeInstanceOf(GuardrailViolationError);
  });
});
