import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolSchema } from '@/lib/db/tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import { actionSchema } from '@/lib/db/actions.node';
import { modelSchema } from '@/lib/db/models.node';
import { modelActionSchema } from '@/lib/db/model-actions.node';
import { modelProviderSchema } from '@/lib/db/model-providers.node';
import { providerSchema } from '@/lib/db/providers.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema } from '@/lib/ai/scopes';
import { agentRunSchema, type AgentRun, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { agentRunStepSchema, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { agentRunCallSchema, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import type { AgentRuntimeDataSource } from '@/lib/ai/agents';
import type { RouterDataSource } from '@/lib/ai/router';
import type { ProviderExecuteRequest } from '@/lib/ai/providers';
import { agentRunSourceSchema, type AgentRunSource } from '@/lib/ai/agent-run-sources';
import { agentArtifactSchema, type AgentArtifact } from '@/lib/ai/agent-artifacts';
import { ArtifactResolverRegistry } from '@/lib/ai/artifact-resolvers';
import { tokenUsage } from '@/lib/ai/shared';
import { normalizeStructuredProviderResponse, runStoredAgentTool } from './run-stored-agent-tool';
import { InvalidRunRequestError, ResponseValidationError } from './validation';
import type { RuntimeEventInput } from '@/platform/events';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema } from '@/lib/db/agent-members.node';

const now = '2026-07-16T00:00:00.000Z';
function fixture(output: unknown = { metadata: { status: 'accepted', reason: 'Task completed', score: 0.95 }, text: 'done' }) {
  const organizationKey = newId();
  const organization = organizationSchema.parse({ key: organizationKey, name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey, slug: 'core', name: 'Core', summary: 'Core product scope', description: 'Core product scope', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organizationKey, email: 'member@example.com', emailHash: 'member-hash', createdAt: now, updatedAt: now });
  const userOrganization = userOrganizationSchema.parse({ key: newId(), organizationId: organizationKey, userId: user.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: userOrganization.key, role: 'moderator' });
  const agent = agentSchema.parse({ key: newId(), slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: 'Build reliable backend systems.' });
  const action = actionSchema.parse({ key: newId(), slug: 'core.chat', name: 'Chat', description: 'Answer', objective: 'Answer', inputDescription: 'Question', outputDescription: 'Answer with metadata', handlerKey: 'core.chat', enabled: true });
  const tool = toolSchema.parse({ key: newId(), slug: 'ask.answer', name: 'Ask', description: 'Answer the user', scopeKey: null, enabled: true });
  const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-nano', name: 'Nano', description: 'Fast model', supportedUseCases: 'Ask', enabled: true });
  const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', handlerKey: 'openai' });
  const agentSkill = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const agentTool = agentToolSchema.parse({ key: newId(), agentKey: agent.key, toolKey: tool.key });
  const toolAction = toolActionSchema.parse({ key: newId(), toolKey: tool.key, actionKey: action.key, priority: 100, enabled: true });
  const modelAction = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: action.key, priority: 100, enabled: true });
  const modelProvider = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-nano', enabled: true });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), organizationKey, scopeKey: scope.key, agentKey: agent.key, position: 1, minimumAccessRole: 'moderator', createdAt: now, updatedAt: now });
  const agentMember = agentMemberSchema.parse({ key: newId(), organizationKey, scopeKey: scope.key, agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey: userOrganization.key, source: 'inherited', createdAt: now });
  const runtimeData: AgentRuntimeDataSource = {
    async getAgent(key) { return key === agent.key ? agent : null; }, async getScope(key) { return key === scope.key ? scope : null; },
    async getOrganization(key) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkill]; }, async getSkill(key) { return key === skill.key ? skill : null; },
    async listAgentTools() { return [agentTool]; }, async getTool(key) { return key === tool.key ? tool : null; },
    async listToolActions() { return [toolAction]; }, async getAction(key) { return key === action.key ? action : null; },
  };
  const routerData: RouterDataSource = {
    async getActionBySlug(slug) { return slug === action.slug ? action : null; }, async getModelBySlug(slug) { return slug === model.slug ? model : null; }, async getModelByKey(key) { return key === model.key ? model : null; },
    async getProviderBySlug(slug) { return slug === provider.slug ? provider : null; }, async getProviderByKey(key) { return key === provider.key ? provider : null; },
    async listModelActions() { return [modelAction]; }, async listModelProviders() { return [modelProvider]; }, async listOrganizationProviderKeys() { return [provider.key]; },
  };
  const runStore: AgentRun[] = []; const stepStore: AgentRunStep[] = []; const callStore: AgentRunCall[] = [];
  const sourceStore: AgentRunSource[] = []; const artifactStore: AgentArtifact[] = [];
  const runs: AgentRunRepository = {
    async insertRun(input) { const value = agentRunSchema.parse({ ...input, key: newId(), createdAt: now }); runStore.push(value); return value; },
    async updateRun(key, input) { const index = runStore.findIndex((value) => value.key === key); if (index < 0) throw new Error('missing run'); const value = agentRunSchema.parse({ ...runStore[index]!, ...input }); runStore[index] = value; return value; },
    async getRunById(key) { return runStore.find((value) => value.key === key) ?? null; }, async listRunsForOrganization() { return runStore; },
  };
  const steps: AgentRunStepRepository = { async insertStep(input) { const value = agentRunStepSchema.parse({ ...input, key: input.key ?? newId() }); stepStore.push(value); return value; }, async listStepsForRun(key) { return stepStore.filter((value) => value.agentRunKey === key); } };
  const calls: AgentRunCallRepository = { async insertCall(input) { const value = agentRunCallSchema.parse({ ...input, key: input.key ?? newId() }); callStore.push(value); return value; }, async listCallsForRun(key) { return callStore.filter((value) => value.agentRunKey === key); } };
  const sources = { async insertSource(input: Parameters<import('@/lib/ai/agent-run-sources').AgentRunSourceRepository['insertSource']>[0]) { const value = agentRunSourceSchema.parse({ ...input, key: input.key ?? newId() }); sourceStore.push(value); return value; }, async listSourcesForRun(key: string) { return sourceStore.filter((value) => value.agentRunKey === key); } };
  const artifacts = { async insertArtifact(input: Parameters<import('@/lib/ai/agent-artifacts').AgentArtifactRepository['insertArtifact']>[0]) { const value = agentArtifactSchema.parse({ ...input, key: input.key ?? newId() }); artifactStore.push(value); return value; }, async listArtifactsForRun(key: string) { return artifactStore.filter((value) => value.agentRunKey === key); } };
  const adapterCalls: ProviderExecuteRequest[] = [];
  const executionSnapshots: Array<{ runStatus: string | undefined; sourceCount: number }> = [];
  const eventStore: RuntimeEventInput[] = [];
  const adapters = { openai: { id: 'openai' as const, name: 'OpenAI', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { adapterCalls.push(request as ProviderExecuteRequest); executionSnapshots.push({ runStatus: runStore[0]?.status, sourceCount: sourceStore.length }); return { output: output as TOutput, usage: tokenUsage(8, 5), providerId: 'openai' as const, modelId: request.modelId, externalModelId: request.externalModelId }; } } };
  const variables = { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return []; } };
  const memories = { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return []; } };
  const accessData = { async getUserOrganization(key: string) { return key === userOrganization.key ? userOrganization : null; }, async getUser(key: string) { return key === user.key ? user : null; }, async listScopeMembers() { return [scopeMember]; }, async getScopeAgent() { return scopeAgent; }, async listAgentMembers() { return [agentMember]; } };
  const options = { runtimeData, data: routerData, adapters, runs, steps, calls, variables, memories, sources, artifacts, events: async (event: RuntimeEventInput) => { eventStore.push(event); }, accessData, principal: { kind: 'member' as const, userOrganizationKey: userOrganization.key } };
  const params = { organizationKey, agentKey: agent.key, toolKey: tool.key, stepSlug: 'answer-request', metadata: { status: 'accepted' as const, reason: 'Inside assigned scope', score: 0.9 }, input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, currentTask: 'Answer the user.', outputSchema: 'Object with metadata and text.' };
  return { options, params, adapterCalls, executionSnapshots, eventStore, runStore, stepStore, callStore, sourceStore, artifactStore, agent, skill, tool, action, model, provider, organizationKey, scope, user, userOrganization, scopeMember, accessData };
}

describe('persisted agent pipeline', () => {
  test('compiles, routes, executes and persists separate run, step and call documents', async () => {
    const f = fixture();
    const result = await runStoredAgentTool<{ metadata: unknown; text: string }>(f.params, f.options);
    expect(result.executed).toBe(true);
    expect(f.runStore[0]?.status).toBe('completed');
    expect(f.runStore[0]).toMatchObject({ principalType: 'member', userOrganizationKey: f.userOrganization.key });
    expect(f.stepStore[0]).toMatchObject({ stepSlug: 'answer-request', status: 'completed', agentRunKey: f.runStore[0]?.key });
    expect(f.callStore[0]).toMatchObject({ skillKey: f.skill.key, toolKey: f.tool.key, actionKey: f.action.key, modelKey: f.model.key, providerKey: f.provider.key, totalTokens: 13 });
    expect((f.adapterCalls[0]?.input as { system?: string }).system).toContain(JSON.stringify({ scopeId: f.agent.scopeKey }));
    expect((f.adapterCalls[0]?.input as { responseFormat?: unknown }).responseFormat).toEqual({ type: 'json' });
    expect(f.eventStore.map(({ slug }) => slug)).toEqual([
      'agent.started', 'step.started', 'tool.called', 'model.called', 'model.completed',
      'step.completed', 'tool.completed', 'agent.completed',
    ]);
    expect(f.eventStore.every(({ scopeId, userId }) => scopeId === f.scope.key && userId === f.user.key)).toBe(true);
    expect(f.eventStore.find(({ slug }) => slug === 'model.completed')?.data).toMatchObject({ callKey: f.callStore[0]?.key, inputTokens: 8, outputTokens: 5 });
  });

  test('rejected metadata stores a summary and never executes tools or creates steps/calls', async () => {
    const f = fixture();
    const result = await runStoredAgentTool({ ...f.params, metadata: { status: 'rejected', reason: 'Outside assigned scope', score: 0.1 } }, f.options);
    expect(result.executed).toBe(false);
    expect(f.adapterCalls).toHaveLength(0);
    expect(f.runStore[0]?.status).toBe('rejected');
    expect(f.stepStore).toHaveLength(0);
    expect(f.callStore).toHaveLength(0);
    expect(f.eventStore.map(({ slug }) => slug)).toEqual(['agent.started', 'agent.failed']);
  });

  test('an ungranted Ask Tool cannot expose direct chat', async () => {
    const f = fixture();
    await expect(runStoredAgentTool({ ...f.params, toolKey: newId() }, f.options)).rejects.toBeInstanceOf(InvalidRunRequestError);
    expect(f.adapterCalls).toHaveLength(0);
    expect(f.eventStore.map(({ slug }) => slug)).toEqual(['guardrail.blocked']);
  });

  test('requires active organization and scope membership before execution', async () => {
    const missingPrincipal = fixture();
    await expect(runStoredAgentTool(missingPrincipal.params, { ...missingPrincipal.options, principal: undefined })).rejects.toBeInstanceOf(InvalidRunRequestError);
    expect(missingPrincipal.runStore).toHaveLength(0);

    const outsideScope = fixture();
    await expect(runStoredAgentTool(outsideScope.params, { ...outsideScope.options, accessData: { ...outsideScope.accessData, async listScopeMembers() { return []; } } })).rejects.toThrow('is not assigned to scope');
    expect(outsideScope.adapterCalls).toHaveLength(0);
    expect(outsideScope.runStore).toHaveLength(0);
  });

  test('rejects duplicate source selections before creating a run', async () => {
    const f = fixture(); const nodeKey = newId(); const source = { nodeType: 'image', nodeKey, priority: 1 };
    await expect(runStoredAgentTool({ ...f.params, sources: [source, source] }, f.options)).rejects.toBeInstanceOf(InvalidRunRequestError);
    expect(f.runStore).toHaveLength(0);
  });

  test('invalid provider output metadata fails and records the actual call', async () => {
    const f = fixture({ text: 'missing metadata' });
    await expect(runStoredAgentTool(f.params, f.options)).rejects.toBeInstanceOf(ResponseValidationError);
    expect(f.runStore[0]?.status).toBe('failed');
    expect(f.callStore[0]?.totalTokens).toBe(13);
  });

  test('strictly decodes OpenAI-compatible JSON text before output validation', async () => {
    const structured = { metadata: { status: 'accepted', reason: 'Task completed', score: 1 }, delegation: { target: 'none', reason: 'NO_ELIGIBLE_DELEGATE' } };
    const f = fixture({ text: JSON.stringify(structured), toolCalls: [], stopReason: 'stop' });
    const result = await runStoredAgentTool(f.params, f.options);
    expect(result.executed && result.response.output).toEqual(structured);
    expect(() => normalizeStructuredProviderResponse({ output: { text: 'free-form answer' }, usage: tokenUsage(1, 1), providerId: 'openai', modelId: 'model', externalModelId: 'model' })).toThrow(ResponseValidationError);
  });

  test('records failed model, step, tool and agent lifecycle events', async () => {
    const f = fixture();
    f.options.adapters.openai!.execute = async () => { throw new Error('Provider unavailable'); };
    await expect(runStoredAgentTool(f.params, f.options)).rejects.toThrow();
    expect(f.eventStore.map(({ slug }) => slug)).toEqual([
      'agent.started', 'step.started', 'tool.called', 'model.called', 'model.failed',
      'step.failed', 'tool.failed', 'agent.failed',
    ]);
    expect(f.eventStore.find(({ slug }) => slug === 'model.failed')?.data).toMatchObject({ callKey: f.callStore[0]?.key, inputTokens: 0, outputTokens: 0 });
    expect(f.eventStore.find(({ slug }) => slug === 'agent.failed')?.data.reason).toContain('Every route for action chat failed');
  });

  test('supports validated rejected outputs and stable multi-step workflows', async () => {
    const f = fixture({ metadata: { status: 'rejected', reason: 'Required tool is unavailable', score: 0.9 }, validation: { readyToPersist: false } });
    let finalized = false;
    const result = await runStoredAgentTool(f.params, { ...f.options, allowRejectedOutput: true, stepSlugs: ['understand-request', 'answer-request'], beforeFinalize: async () => { finalized = true; } });
    expect(result.executed).toBe(true); expect(result.run.status).toBe('rejected'); expect(finalized).toBe(true);
    expect(f.stepStore.map((step) => step.stepSlug)).toEqual(['understand-request', 'answer-request']);
    expect(f.stepStore.every((step) => step.status === 'completed')).toBe(true);
  });

  test('resolves explicit sources into context and persists source provenance', async () => {
    const f = fixture(); const nodeKey = newId();
    const artifactResolvers = new ArtifactResolverRegistry().register('blog-post', {
      async exists(key) { return key === nodeKey; },
      async getReference(key) { return key === nodeKey ? { nodeType: 'blog-post', nodeKey, organizationKey: f.organizationKey, scopeKey: f.scope.key, name: 'Launch post', summary: 'A compact source summary.' } : null; },
      async getContent() { throw new Error('full content must not be injected'); }, async findSimilar() { return []; },
    });
    const result = await runStoredAgentTool({ ...f.params, sources: [{ nodeType: 'blog-post', nodeKey, priority: 100 }] }, { ...f.options, artifactResolvers });
    expect(result.executed).toBe(true);
    expect((f.adapterCalls[0]?.input as { system?: string }).system).toContain('A compact source summary.');
    expect((f.adapterCalls[0]?.input as { system?: string }).system).toContain('"effectiveExplorationRate":0.5');
    expect((f.adapterCalls[0]?.input as { system?: string }).system).toContain('"sourceCount":1');
    expect(f.sourceStore[0]).toMatchObject({ agentRunKey: f.runStore[0]?.key, nodeType: 'blog-post', nodeKey, priority: 100 });
    expect(f.artifactStore[0]).toMatchObject({ agentRunKey: f.runStore[0]?.key, nodeType: 'blog-post', nodeKey, relation: 'source', position: 0 });
    expect(f.eventStore.find(({ slug }) => slug === 'artifact.used')?.data).toMatchObject({ runKey: f.runStore[0]?.key, agentKey: f.agent.key, nodeType: 'blog-post', nodeKey });
    expect(f.executionSnapshots[0]).toEqual({ runStatus: 'accepted', sourceCount: 1 });
  });
});
