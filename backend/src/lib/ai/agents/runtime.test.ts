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
import { organizationSchema } from '@/lib/db/organizations.node';
import { runtimeVariableSchema } from '@/lib/ai/runtime-variables';
import { agentMemorySchema } from '@/lib/ai/agent-memories';
import { compileAgentContext, compileAgentRuntimeContext, loadAgentRuntime, type AgentRuntimeDataSource } from './runtime';
import { createNodeResolver, NodeResolverRegistry, ReverseContextCompiler, type SearchableDocument } from '@/lib/ai/reverse-context';

const keys = { organization: newId(), scope: newId(), agent: newId(), backend: newId(), devops: newId(), tool: newId(), action: newId(), backendLink: newId(), devopsLink: newId(), agentTool: newId(), toolAction: newId() };
const agent = agentSchema.parse({ key: keys.agent, slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: keys.scope });
const scope = scopeSchema.parse({ key: keys.scope, organizationKey: keys.organization, slug: 'platform', name: 'Platform', description: 'Backend platform workspace.' });
const organization = organizationSchema.parse({ key: keys.organization, name: 'Vorinthex', createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z' });
const backend = skillSchema.parse({ key: keys.backend, slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: 'Build reliable backend services.' });
const devops = skillSchema.parse({ key: keys.devops, slug: 'devops-engineer', name: 'DevOps', title: 'DevOps Engineer', definition: 'Operate reliable infrastructure.' });
const tool = toolSchema.parse({ key: keys.tool, slug: 'reason.solve', name: 'Reason', description: 'Solve hard engineering problems.' });
const action = actionSchema.parse({ key: keys.action, slug: 'core.reason', name: 'Reason', description: 'Reason through a problem.', objective: 'Solve it.', inputDescription: 'A problem.', outputDescription: 'A solution.', handlerKey: 'core.reason' });
function source(): AgentRuntimeDataSource {
  return {
    async getAgent(key) { return key === agent.key ? agent : null; }, async getScope(key) { return key === scope.key ? scope : null; },
    async getOrganization(key) { return key === organization.key ? organization : null; },
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
    const runtime = await loadAgentRuntime(agent.key, source());
    const variable = runtimeVariableSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, name: 'release.channel', value: 'stable' });
    const memory = agentMemorySchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, skillKey: backend.key, sourceRunKey: null, content: 'Prefer reversible migrations.', memoryType: 'instruction', importance: 0.9, createdAt: '2026-07-16T00:00:00.000Z' });
    const context = await compileAgentContext(runtime, { currentTask: 'Diagnose the production API.', variables: { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return [variable]; } }, memories: { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return [memory]; } } });
    const compiled = compileAgentRuntimeContext(context, { outputSchema: '{ "status": "string" }' });
    expect(compiled.indexOf('priority 100')).toBeLessThan(compiled.indexOf('priority 90'));
    expect(compiled).toContain('# Forge — Backend Developer');
    expect(compiled).toContain(JSON.stringify({ scopeId: scope.key }));
    expect(compiled).toContain('reason.solve');
    expect(compiled).toContain('core.reason');
    expect(compiled).toContain('at most ten words');
    expect(compiled).toContain('release.channel');
    expect(compiled).toContain('Prefer reversible migrations.');
    expect(context.sourcePolicy).toEqual({ requestedExplorationRate: 0.5, effectiveExplorationRate: 1, sourceCount: 0 });
  });
  test('rejects agents without skills', async () => { const empty = source(); empty.listAgentSkills = async () => []; await expect(loadAgentRuntime(agent.key, empty)).rejects.toThrow('has no skills'); });
  test('rejects a granted tool scoped outside the agent scope', async () => {
    const mismatched = source();
    mismatched.getTool = async () => toolSchema.parse({ ...tool, scopeKey: newId() });
    await expect(loadAgentRuntime(agent.key, mismatched)).rejects.toBeInstanceOf(GuardrailViolationError);
  });
  test('injects only a bounded normalized knowledge pack into provider context', async () => {
    const runtime = await loadAgentRuntime(agent.key, source());
    const document: SearchableDocument = { key: newId(), organizationKey: organization.key, scopeKey: scope.key, embedding: [1, 0], name: 'Deployment Guide', content: 'Use a reversible rollout.', _key: 'hidden-storage-key' };
    const resolver = createNodeResolver({ nodeType: 'document', embeddingFields: ['name', 'content'], data: { async get(key) { return key === document.key ? document : null; }, async list() { return [document]; } }, titleField: 'name', summaryFields: ['name', 'content'] });
    const compiler = new ReverseContextCompiler({ registry: new NodeResolverRegistry().register(resolver), generateEmbedding: async () => [1, 0] });
    const context = await compileAgentContext(runtime, { currentTask: 'Plan the deployment.', reverseContextCompiler: compiler, knowledgeNodeTypes: ['document'], variables: { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return []; } }, memories: { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return []; } } });
    const rendered = compileAgentRuntimeContext(context);
    expect(context.knowledge.pack.blocks[0]).toMatchObject({ nodeType: 'document', title: 'Deployment Guide', content: null });
    expect(rendered).toContain('Deployment Guide');
    expect(rendered).not.toContain('hidden-storage-key');
    expect(rendered).not.toContain('embeddingFields');
  });
});
