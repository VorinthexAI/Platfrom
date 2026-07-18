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
import { agentRunSchema, type AgentRun, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { agentRunStepSchema, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { agentRunCallSchema, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import type { AgentRuntimeDataSource } from '@/lib/ai/agents';
import type { RouterDataSource } from '@/lib/ai/router';
import type { ProviderAdapter, ProviderExecuteRequest, ProviderStreamChunk } from '@/lib/ai/providers';
import { ProviderError } from '@/lib/ai/providers/errors';
import { tokenUsage } from '@/lib/ai/shared';
import type { RuntimeEventInput } from '@/platform/events';
import { BeaconAskRequestError, BeaconUnavailableError, streamFoundersBeaconAsk, type BeaconAskEvent } from './ask';

const now = '2026-07-17T00:00:00.000Z';

function fixture(chunks?: () => AsyncIterable<ProviderStreamChunk>, organizationKey = newId(), membershipKey = newId()) {
  const organization = organizationSchema.parse({ key: organizationKey, name: 'Vorinthex AI', is_root: true, createdAt: now, updatedAt: now });
  const beaconScope = scopeSchema.parse({ key: newId(), organizationKey, slug: 'nexus', name: 'Nexus', summary: 'The complete ecosystem.', description: 'The complete ecosystem.', position: 1 });
  const selectedScope = scopeSchema.parse({ key: newId(), organizationKey, slug: 'core', name: 'Core', summary: 'Personal AI brain scope.', description: 'Personal AI brain scope.', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organizationKey, email: 'founder@example.com', emailHash: 'founder-hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: membershipKey, organizationId: organizationKey, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const agent = agentSchema.parse({ key: newId(), slug: 'beacon', name: 'Beacon', title: 'AI Coordinator', scopeKey: beaconScope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'beacon-coordination', name: 'Beacon', title: 'AI Coordinator', definition: 'Answer founders precisely.' });
  const action = actionSchema.parse({ key: newId(), slug: 'core.ask', name: 'Ask', description: 'Answer', objective: 'Answer', inputDescription: 'Question', outputDescription: 'Answer', handlerKey: 'core.ask', enabled: true });
  const tool = toolSchema.parse({ key: newId(), slug: 'ask.answer', name: 'Ask', description: 'Answer the user', scopeKey: null, enabled: true });
  const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-nano', name: 'Nano', description: 'Fast model', supportedUseCases: 'Ask', enabled: true });
  const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai', enabled: true });
  const agentSkill = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const agentTool = agentToolSchema.parse({ key: newId(), agentKey: agent.key, toolKey: tool.key });
  const toolAction = toolActionSchema.parse({ key: newId(), toolKey: tool.key, actionKey: action.key, priority: 100, enabled: true });
  const modelAction = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: action.key, priority: 100, enabled: true });
  const modelProvider = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-nano', enabled: true });

  const runtimeData: AgentRuntimeDataSource = {
    async getAgent(key) { return key === agent.key ? agent : null; },
    async getScope(key) { return key === beaconScope.key ? beaconScope : key === selectedScope.key ? selectedScope : null; },
    async getOrganization(key) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkill]; },
    async getSkill(key) { return key === skill.key ? skill : null; },
    async listAgentTools() { return [agentTool]; },
    async getTool(key) { return key === tool.key ? tool : null; },
    async listToolActions() { return [toolAction]; },
    async getAction(key) { return key === action.key ? action : null; },
  };
  const routerData: RouterDataSource = {
    async getActionBySlug(slug) { return slug === action.slug ? action : null; },
    async getModelBySlug(slug) { return slug === model.slug ? model : null; },
    async getModelByKey(key) { return key === model.key ? model : null; },
    async getProviderBySlug(slug) { return slug === provider.slug ? provider : null; },
    async getProviderByKey(key) { return key === provider.key ? provider : null; },
    async listModelActions() { return [modelAction]; },
    async listModelProviders() { return [modelProvider]; },
    async listOrganizationProviderKeys() { return [provider.key]; },
  };

  const runStore: AgentRun[] = [];
  const stepStore: AgentRunStep[] = [];
  const callStore: AgentRunCall[] = [];
  const runs: AgentRunRepository = {
    async insertRun(input) { const value = agentRunSchema.parse({ ...input, key: newId(), createdAt: now }); runStore.push(value); return value; },
    async updateRun(key, input) { const index = runStore.findIndex((value) => value.key === key); if (index < 0) throw new Error('missing run'); const value = agentRunSchema.parse({ ...runStore[index]!, ...input }); runStore[index] = value; return value; },
    async getRunById(key) { return runStore.find((value) => value.key === key) ?? null; },
    async listRunsForOrganization() { return runStore; },
  };
  const steps: AgentRunStepRepository = {
    async insertStep(input) { const value = agentRunStepSchema.parse({ ...input, key: input.key ?? newId() }); stepStore.push(value); return value; },
    async listStepsForRun(key) { return stepStore.filter((value) => value.agentRunKey === key); },
  };
  const calls: AgentRunCallRepository = {
    async insertCall(input) { const value = agentRunCallSchema.parse({ ...input, key: input.key ?? newId() }); callStore.push(value); return value; },
    async listCallsForRun(key) { return callStore.filter((value) => value.agentRunKey === key); },
  };

  const adapterRequests: ProviderExecuteRequest[] = [];
  const defaultChunks = async function* (): AsyncIterable<ProviderStreamChunk> {
    yield { type: 'text-delta', text: 'Hello ' };
    yield { type: 'text-delta', text: 'founder.' };
    yield { type: 'usage', usage: tokenUsage(11, 7) };
    yield { type: 'done' };
  };
  const adapter: ProviderAdapter = {
    id: 'openai',
    name: 'OpenAI',
    async execute() { throw new Error('buffered execute must not be used when stream exists'); },
    stream(request) {
      adapterRequests.push(request as ProviderExecuteRequest);
      return (chunks ?? defaultChunks)();
    },
  };

  const eventStore: RuntimeEventInput[] = [];
  const variables = { async insertVariable() { throw new Error('unused'); }, async listVariablesForContext() { return []; } };
  const memories = { async insertMemory() { throw new Error('unused'); }, async listMemoriesForAgent() { return []; } };

  const params = { organization, scope: selectedScope, membership, user, message: 'What is the Nexus?' };
  const options = {
    getAgent: async (slug: string) => (slug === 'beacon' ? agent : null),
    runtimeData,
    data: routerData,
    adapters: { openai: adapter },
    runs,
    steps,
    calls,
    variables,
    memories,
    events: async (event: RuntimeEventInput) => { eventStore.push(event); },
  };
  return { params, options, adapter, adapterRequests, eventStore, runStore, stepStore, callStore, organization, beaconScope, selectedScope, user, membership, agent, skill, tool, action, model, provider };
}

async function collect(iterable: AsyncGenerator<BeaconAskEvent>) {
  const events: BeaconAskEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('streamFoundersBeaconAsk', () => {
  test('streams deltas progressively and persists an isolated completed run in the selected scope', async () => {
    const f = fixture();
    const events = await collect(streamFoundersBeaconAsk(f.params, f.options));
    expect(events[0]).toEqual({ type: 'started', runKey: f.runStore[0]!.key });
    expect(events.filter((event) => event.type === 'delta').map((event) => (event as { text: string }).text)).toEqual(['Hello ', 'founder.']);
    expect(events.at(-1)).toEqual({ type: 'completed', runKey: f.runStore[0]!.key });

    expect(f.runStore).toHaveLength(1);
    expect(f.runStore[0]).toMatchObject({
      status: 'completed',
      organizationKey: f.organization.key,
      scopeKey: f.selectedScope.key,
      agentKey: f.agent.key,
      principalType: 'member',
      userOrganizationKey: f.membership.key,
      score: 1,
    });
    expect(f.stepStore[0]).toMatchObject({ stepSlug: 'founders-beacon-ask', status: 'completed', agentRunKey: f.runStore[0]!.key });
    expect(f.callStore[0]).toMatchObject({ skillKey: f.skill.key, toolKey: f.tool.key, actionKey: f.action.key, modelKey: f.model.key, providerKey: f.provider.key, inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    expect(f.eventStore.map(({ slug }) => slug)).toEqual([
      'agent.started', 'step.started', 'tool.called', 'model.called',
      'model.completed', 'step.completed', 'tool.completed', 'agent.completed',
    ]);
    expect(f.eventStore.every(({ scopeId, userId }) => scopeId === f.selectedScope.key && userId === f.user.key)).toBe(true);
  });

  test('streams Beacon end to end when Nexus itself is the selected scope', async () => {
    const f = fixture();
    const events = await collect(streamFoundersBeaconAsk({ ...f.params, scope: f.beaconScope }, f.options));

    expect(events.filter((event) => event.type === 'delta').map((event) => (event as { text: string }).text))
      .toEqual(['Hello ', 'founder.']);
    expect(f.runStore[0]).toMatchObject({
      status: 'completed',
      organizationKey: f.organization.key,
      scopeKey: f.beaconScope.key,
      agentKey: f.agent.key,
    });
    expect(f.adapterRequests).toHaveLength(1);
    expect(f.eventStore.every(({ scopeId }) => scopeId === f.beaconScope.key)).toBe(true);
  });

  test('streams Beacon for preserved pre-CUID root and membership keys', async () => {
    const f = fixture(undefined, 'legacy-root-key', 'legacy-membership-key');
    const events = await collect(streamFoundersBeaconAsk(f.params, f.options));

    expect(events.at(-1)?.type).toBe('completed');
    expect(f.runStore[0]?.organizationKey).toBe('legacy-root-key');
    expect(f.runStore[0]?.userOrganizationKey).toBe('legacy-membership-key');
    expect(f.adapterRequests[0]?.organizationKey).toBe('legacy-root-key');
  });

  test('compiles the context against the selected scope with a plain user-text output contract', async () => {
    const f = fixture();
    await collect(streamFoundersBeaconAsk(f.params, f.options));
    const input = f.adapterRequests[0]!.input as { system?: string; messages: Array<{ role: string; content: string }> };
    expect(input.messages).toEqual([{ role: 'user', content: 'What is the Nexus?' }]);
    expect(input.system).toContain('Beacon — AI Coordinator');
    expect(input.system).toContain(f.selectedScope.description ?? '');
    expect(input.system).toContain('plain Markdown text');
    expect(input.system).not.toContain('"status": "accepted" | "rejected"');
  });

  test('rejects empty, whitespace-only and oversized messages before any run exists', async () => {
    const f = fixture();
    await expect(collect(streamFoundersBeaconAsk({ ...f.params, message: '   ' }, f.options))).rejects.toThrow();
    await expect(collect(streamFoundersBeaconAsk({ ...f.params, message: 'x'.repeat(20_001) }, f.options))).rejects.toThrow();
    expect(f.runStore).toHaveLength(0);
    expect(f.adapterRequests).toHaveLength(0);
  });

  test('rejects a scope from another organization', async () => {
    const f = fixture();
    const foreignScope = { ...f.selectedScope, organizationKey: newId() };
    await expect(collect(streamFoundersBeaconAsk({ ...f.params, scope: foreignScope }, f.options)))
      .rejects.toBeInstanceOf(BeaconAskRequestError);
    expect(f.runStore).toHaveLength(0);
  });

  test('rejects inactive and mismatched memberships', async () => {
    const suspended = fixture();
    await expect(collect(streamFoundersBeaconAsk({ ...suspended.params, membership: { ...suspended.params.membership, status: 'suspended' as const } }, suspended.options)))
      .rejects.toBeInstanceOf(BeaconAskRequestError);

    const foreign = fixture();
    await expect(collect(streamFoundersBeaconAsk({ ...foreign.params, membership: { ...foreign.params.membership, organizationId: newId() } }, foreign.options)))
      .rejects.toBeInstanceOf(BeaconAskRequestError);
    expect(foreign.runStore).toHaveLength(0);
  });

  test('fails safely when beacon is not registered', async () => {
    const f = fixture();
    await expect(collect(streamFoundersBeaconAsk(f.params, { ...f.options, getAgent: async () => null })))
      .rejects.toBeInstanceOf(BeaconUnavailableError);
    expect(f.runStore).toHaveLength(0);
  });

  test('fails safely when no model route is enabled for the organization', async () => {
    const f = fixture();
    const data = { ...f.options.data, async listOrganizationProviderKeys() { return []; } };
    await expect(collect(streamFoundersBeaconAsk(f.params, { ...f.options, data })))
      .rejects.toBeInstanceOf(BeaconUnavailableError);
    expect(f.runStore).toHaveLength(0);
    expect(f.adapterRequests).toHaveLength(0);
  });

  test('a provider failure mid-stream persists a failed run and lifecycle events', async () => {
    const f = fixture(async function* () {
      yield { type: 'text-delta', text: 'partial' } as ProviderStreamChunk;
      throw new ProviderError('openai', 'provider_unavailable', 'openai request failed with status 503');
    });
    await expect(collect(streamFoundersBeaconAsk(f.params, f.options))).rejects.toBeInstanceOf(ProviderError);
    expect(f.runStore[0]?.status).toBe('failed');
    expect(f.stepStore[0]?.status).toBe('failed');
    expect(f.eventStore.map(({ slug }) => slug)).toEqual([
      'agent.started', 'step.started', 'tool.called', 'model.called',
      'model.failed', 'step.failed', 'tool.failed', 'agent.failed',
    ]);
    expect(f.eventStore.find(({ slug }) => slug === 'agent.failed')?.data.reason).toContain('503');
  });

  test('an aborted stream persists a cancelled run', async () => {
    const f = fixture(async function* () {
      yield { type: 'text-delta', text: 'part' } as ProviderStreamChunk;
      throw new ProviderError('openai', 'aborted', 'openai request aborted');
    });
    await expect(collect(streamFoundersBeaconAsk(f.params, f.options))).rejects.toThrow();
    expect(f.runStore[0]?.status).toBe('cancelled');
  });

  test('a consumer that disconnects mid-stream finalizes the run as cancelled', async () => {
    const f = fixture();
    const stream = streamFoundersBeaconAsk(f.params, f.options);
    for await (const event of stream) {
      if (event.type === 'delta') break;
    }
    expect(f.runStore[0]?.status).toBe('cancelled');
    expect(f.eventStore.map(({ slug }) => slug)).toEqual([
      'agent.started', 'step.started', 'tool.called', 'model.called',
      'model.failed', 'step.failed', 'tool.failed', 'agent.failed',
    ]);
  });

  test('concurrent founders each get their own isolated run', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      collect(streamFoundersBeaconAsk(f.params, f.options)),
      collect(streamFoundersBeaconAsk(f.params, f.options)),
    ]);
    const firstRun = (first[0] as { runKey: string }).runKey;
    const secondRun = (second[0] as { runKey: string }).runKey;
    expect(firstRun).not.toBe(secondRun);
    expect(f.runStore).toHaveLength(2);
    expect(f.runStore.every((run) => run.status === 'completed')).toBe(true);
  });

  test('falls back to a single buffered delta when the provider cannot stream', async () => {
    const f = fixture();
    const buffered: ProviderAdapter = {
      id: 'openai',
      name: 'OpenAI',
      async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
        f.adapterRequests.push(request as ProviderExecuteRequest);
        return { output: { text: 'Full answer.', toolCalls: [], stopReason: 'stop' } as TOutput, usage: tokenUsage(4, 3), providerId: 'openai' as const, modelId: request.modelId, externalModelId: request.externalModelId };
      },
    };
    const events = await collect(streamFoundersBeaconAsk(f.params, { ...f.options, adapters: { openai: buffered } }));
    expect(events.filter((event) => event.type === 'delta')).toEqual([{ type: 'delta', text: 'Full answer.' }]);
    expect(f.runStore[0]?.status).toBe('completed');
    expect(f.callStore[0]?.totalTokens).toBe(7);
  });
});
