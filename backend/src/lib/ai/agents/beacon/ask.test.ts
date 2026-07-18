import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolSchema } from '@/lib/db/tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import { actionSchema } from '@/lib/db/actions.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { agentRunSchema } from '@/lib/ai/agent-runs';
import type { RunStoredAgentToolOptions, RunStoredAgentToolParams, StoredAgentRunResult } from '@/lib/ai/pipeline';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';
import { tokenUsage } from '@/lib/ai/shared';
import type { GenesisCreationResult } from '@/lib/ai/agents/genesis';
import {
  BEACON_NO_DELEGATE_MESSAGE,
  BEACON_DELEGATE_REGISTRY,
  BeaconUnavailableError,
  beaconDelegationDecisionSchema,
  streamFoundersBeaconAsk,
  type BeaconAskEvent,
} from './ask';

const now = '2026-07-18T00:00:00.000Z';

function fixture(extraTool = false) {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const home = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'nexus', name: 'Nexus', summary: 'Nexus', description: 'Nexus', position: 1 });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const beacon = agentSchema.parse({ key: newId(), slug: 'beacon', name: 'Beacon', title: 'AI Coordinator', scopeKey: home.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'beacon-coordination', name: 'Beacon', title: 'AI Coordinator', definition: 'Delegate only.' });
  const delegateTool = toolSchema.parse({ key: newId(), slug: 'core.delegate', name: 'Delegate', description: 'Delegate safely.' });
  const delegateAction = actionSchema.parse({ key: newId(), slug: 'core.delegate', name: 'Delegate', description: 'Delegate safely.', objective: 'Delegate', inputDescription: 'Task', outputDescription: 'Decision', handlerKey: 'core.delegate' });
  const askTool = toolSchema.parse({ key: newId(), slug: 'ask.answer', name: 'Ask', description: 'Forbidden direct answer.' });
  const askAction = actionSchema.parse({ key: newId(), slug: 'core.ask', name: 'Ask', description: 'Ask.', objective: 'Ask', inputDescription: 'Task', outputDescription: 'Answer', handlerKey: 'core.ask' });
  const toolLinks = [agentToolSchema.parse({ key: newId(), agentKey: beacon.key, toolKey: delegateTool.key })];
  if (extraTool) toolLinks.push(agentToolSchema.parse({ key: newId(), agentKey: beacon.key, toolKey: askTool.key }));
  const runtimeData = {
    async getAgent(key: string) { return key === beacon.key ? beacon : null; },
    async getScope(key: string) { return key === home.key ? home : null; },
    async getOrganization(key: string) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkillSchema.parse({ key: newId(), agentKey: beacon.key, skillKey: skill.key, priority: 100 })]; },
    async getSkill() { return skill; },
    async listAgentTools() { return toolLinks; },
    async getTool(key: string) { return key === delegateTool.key ? delegateTool : key === askTool.key ? askTool : null; },
    async listToolActions(toolKey: string) { return [toolActionSchema.parse({ key: newId(), toolKey, actionKey: toolKey === delegateTool.key ? delegateAction.key : askAction.key, priority: 100 })]; },
    async getAction(key: string) { return key === delegateAction.key ? delegateAction : key === askAction.key ? askAction : null; },
  };
  return { organization, scope, user, membership, beacon, runtimeData, params: { organization, scope, user, membership, message: 'How many scopes do we have?' } };
}

async function collect(iterable: AsyncGenerator<BeaconAskEvent>) { const events: BeaconAskEvent[] = []; for await (const event of iterable) events.push(event); return events; }

function runToolReturning(output: unknown, captured: Array<{ params: RunStoredAgentToolParams; options: RunStoredAgentToolOptions }>) {
  return (async (params: RunStoredAgentToolParams, options: RunStoredAgentToolOptions = {}) => {
    captured.push({ params, options });
    const run = agentRunSchema.parse({ key: newId(), organizationKey: params.organizationKey, scopeKey: newId(), agentKey: params.agentKey, principalType: 'member', userOrganizationKey: newId(), status: 'accepted', reason: params.metadata.reason, score: 1, startedAt: now, endedAt: now, elapsedMs: 0, createdAt: now });
    const response = { output, usage: tokenUsage(2, 1), providerId: 'openai', modelId: 'openai.gpt-5.4-mini', externalModelId: 'gpt-5.4-mini' } as ProviderExecuteResponse<unknown>;
    await options.beforeFinalize?.({ run, response, agentContext: {} as never, recordArtifactCreated: async () => {} });
    return { executed: true, run, step: {} as never, calls: [], response } as StoredAgentRunResult<unknown>;
  }) as never;
}

describe('Beacon delegate-only ask', () => {
  test('has only Genesis in the server-owned specialist allowlist', () => {
    expect(BEACON_DELEGATE_REGISTRY).toEqual([{ agentSlug: 'genesis', operation: 'agent.create', description: 'Create or design a new agent architecture.' }]);
  });

  test('returns only the server-owned no-delegate message for an unsupported organization question', async () => {
    const f = fixture(); const captured: Array<{ params: RunStoredAgentToolParams; options: RunStoredAgentToolOptions }> = [];
    const output = { metadata: { status: 'accepted', reason: 'No matching specialist', score: 1 }, delegation: { target: 'none', reason: 'NO_ELIGIBLE_DELEGATE' } };
    const events = await collect(streamFoundersBeaconAsk(f.params, { runtimeData: f.runtimeData, getAgent: async () => f.beacon, runTool: runToolReturning(output, captured) }));
    expect(events.map((event) => event.type)).toEqual(['started', 'delta', 'completed']);
    expect(events[1]).toEqual({ type: 'delta', text: BEACON_NO_DELEGATE_MESSAGE });
    expect(captured[0]?.params).toMatchObject({ currentTask: f.params.message, stepSlug: 'select-delegate' });
    expect(captured[0]?.options).toMatchObject({ reasoningActionSlug: 'core.reason', serviceDelegation: { agentSlug: 'beacon', requiredOrganizationRole: null }, principal: { kind: 'member', userOrganizationKey: f.membership.key } });
  });

  test('delegates an explicit agent creation request to the allow-listed Genesis path', async () => {
    const f = fixture(); const captured: Array<{ params: RunStoredAgentToolParams; options: RunStoredAgentToolOptions }> = []; let delegatedRequest = '';
    const output = { metadata: { status: 'accepted', reason: 'Genesis matches request', score: 1 }, delegation: { target: 'genesis', operation: 'agent.create', request: 'Create a finance agent.' } };
    const events = await collect(streamFoundersBeaconAsk({ ...f.params, message: 'Create a finance agent.' }, {
      runtimeData: f.runtimeData, getAgent: async () => f.beacon, runTool: runToolReturning(output, captured),
      delegateCreation: (async ({ input }: { input: { request: string } }) => { delegatedRequest = input.request; return { beaconRunKey: newId(), genesisRunKey: newId(), creation: { persisted: true, toolOutput: { status: 'created' } } }; }) as never,
    }));
    expect(delegatedRequest).toBe('Create a finance agent.');
    expect(events[1]).toEqual({ type: 'delta', text: 'Genesis created the requested agent architecture.' });
  });

  test('forwards nested specialist tool events through the same live channel', async () => {
    const f = fixture(); const captured: Array<{ params: RunStoredAgentToolParams; options: RunStoredAgentToolOptions }> = [];
    const output = { metadata: { status: 'accepted', reason: 'Genesis matches request', score: 1 }, delegation: { target: 'genesis', operation: 'agent.create', request: 'Create an agent.' } };
    const invocationKey = newId();
    const events = await collect(streamFoundersBeaconAsk({ ...f.params, message: 'Create an agent.' }, {
      runtimeData: f.runtimeData, getAgent: async () => f.beacon, runTool: runToolReturning(output, captured), events: async () => {},
      delegateCreation: (async (_params: unknown, delegateOptions: RunStoredAgentToolOptions) => {
        const identity = { invocationKey, agentKey: newId(), agentSlug: 'genesis', agentName: 'Genesis', toolKey: newId(), toolSlug: 'agent.create', toolName: 'Create agent', actionKey: newId(), actionSlug: 'agent.create', actionName: 'Create agent' };
        await delegateOptions.events?.({ scopeId: f.scope.key, slug: 'tool.called', data: { ...identity, status: 'called' } });
        await delegateOptions.events?.({ scopeId: f.scope.key, slug: 'tool.completed', data: { ...identity, status: 'completed', elapsedMs: 31 } });
        return { beaconRunKey: newId(), genesisRunKey: newId(), creation: { persisted: true, toolOutput: { status: 'created' } } };
      }) as never,
    }));
    const activities = events.filter((event) => event.type === 'tool').map((event) => event.activity);
    expect(activities).toEqual([
      expect.objectContaining({ invocationId: 'tool-1', phase: 'started', agent: { slug: 'genesis', name: 'Genesis' }, tool: { slug: 'agent.create', name: 'Create agent' } }),
      expect.objectContaining({ invocationId: 'tool-1', phase: 'completed', elapsedMs: 31 }),
    ]);
  });

  test('yields tool activity before the underlying execution completes', async () => {
    const f = fixture();
    const output = { metadata: { status: 'accepted', reason: 'No matching specialist', score: 1 }, delegation: { target: 'none', reason: 'NO_ELIGIBLE_DELEGATE' } };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const runKey = newId(); const invocationKey = newId();
    const runTool = (async (params: RunStoredAgentToolParams, options: RunStoredAgentToolOptions = {}) => {
      const run = agentRunSchema.parse({ key: runKey, organizationKey: params.organizationKey, scopeKey: f.scope.key, agentKey: params.agentKey, principalType: 'member', userOrganizationKey: f.membership.key, status: 'accepted', reason: params.metadata.reason, score: 1, startedAt: now, endedAt: now, elapsedMs: 0, createdAt: now });
      const identity = { invocationKey, runKey, agentKey: f.beacon.key, agentSlug: 'beacon', agentName: 'Beacon', toolKey: newId(), toolSlug: 'core.delegate', toolName: 'Delegate', actionKey: newId(), actionSlug: 'core.delegate', actionName: 'Delegate' };
      await options.events?.({ scopeId: f.scope.key, slug: 'agent.started', data: { runKey, agentKey: f.beacon.key, status: 'started' } });
      await options.events?.({ scopeId: f.scope.key, slug: 'tool.called', data: { ...identity, status: 'called' } });
      await blocked;
      await options.events?.({ scopeId: f.scope.key, slug: 'tool.completed', data: { ...identity, status: 'completed', elapsedMs: 17 } });
      const response = { output, usage: tokenUsage(2, 1), providerId: 'openai', modelId: 'openai.gpt-5.4-mini', externalModelId: 'gpt-5.4-mini' } as ProviderExecuteResponse<unknown>;
      await options.beforeFinalize?.({ run, response, agentContext: {} as never, recordArtifactCreated: async () => {} });
      return { executed: true, run, step: {} as never, calls: [], response } as StoredAgentRunResult<unknown>;
    }) as never;
    const iterator = streamFoundersBeaconAsk(f.params, { runtimeData: f.runtimeData, getAgent: async () => f.beacon, runTool, events: async () => {} });
    expect((await iterator.next()).value).toEqual({ type: 'started', runKey });
    expect((await iterator.next()).value).toMatchObject({ type: 'tool', activity: { invocationId: 'tool-1', phase: 'started', agent: { slug: 'beacon' }, tool: { slug: 'core.delegate' } } });
    release();
    expect((await iterator.next()).value).toMatchObject({ type: 'tool', activity: { invocationId: 'tool-1', phase: 'completed', elapsedMs: 17 } });
    expect((await iterator.next()).value).toEqual({ type: 'delta', text: BEACON_NO_DELEGATE_MESSAGE });
    expect((await iterator.next()).value).toEqual({ type: 'completed', runKey });
  });

  test('strictly rejects model prose or an unregistered specialist instead of surfacing an answer', () => {
    expect(beaconDelegationDecisionSchema.safeParse({ metadata: { status: 'accepted', reason: 'Answer directly', score: 1 }, delegation: { target: 'none', reason: 'NO_ELIGIBLE_DELEGATE' }, answer: 'There are seven scopes.' }).success).toBe(false);
    expect(beaconDelegationDecisionSchema.safeParse({ metadata: { status: 'accepted', reason: 'Use Steward', score: 1 }, delegation: { target: 'steward', operation: 'scope.list', request: 'Count scopes.' } }).success).toBe(false);
  });

  test('refuses to run when Beacon has any direct-answer tool grant', async () => {
    const f = fixture(true);
    await expect(collect(streamFoundersBeaconAsk(f.params, { runtimeData: f.runtimeData, getAgent: async () => f.beacon }))).rejects.toBeInstanceOf(BeaconUnavailableError);
  });
});
