import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { sourceSelectionSchema } from '@/lib/ai/agent-run-sources';
import { getAgentBySlug, loadAgentRuntime, type Agent } from '@/lib/ai/agents';
import { createAgentFromGenesis, type ExecuteGenesisOptions } from '@/lib/ai/genesis';
import { getDefaultAgentRunRepository, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunStepRepository, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import type { Organization } from '@/lib/db/organizations.node';
import type { User } from '@/lib/db/users.node';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { Scope } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { recordRuntimeEvent, type RuntimeEventRecorder } from '@/platform/events';
import { BEACON_AGENT_NAME, BEACON_AGENT_SLUG, BEACON_AGENT_TITLE, BEACON_DELEGATE_TOOL_SLUG } from './seed';

const DELEGATE_REASON = 'Beacon delegated agent creation';

export const beaconDelegateInputSchema = z.object({
  request: z.string().trim().min(1).max(20_000),
  requestedExplorationRate: z.number().min(0).max(1).optional(),
  sourceRefs: z.array(sourceSelectionSchema.extend({ priority: z.number().int().nonnegative().default(100) }).strict()).max(100).default([]),
}).strict();
export type BeaconDelegateInput = z.input<typeof beaconDelegateInputSchema>;

export class BeaconDelegationError extends AiError {
  constructor(detail: string) { super('beacon_delegation_denied', `Beacon delegation denied: ${detail}`); }
}

export interface BeaconDelegateParams {
  organization: Organization;
  scope: Scope;
  membership: UserOrganization;
  user: User;
  input: BeaconDelegateInput;
}

export interface BeaconDelegateOptions extends ExecuteGenesisOptions {
  resolveAgent?: (slug: string) => Promise<Agent | null>;
  createFromGenesis?: typeof createAgentFromGenesis;
  runs?: AgentRunRepository;
  steps?: AgentRunStepRepository;
  events?: RuntimeEventRecorder;
}

/** Local core.delegate handler. Beacon may call only the fixed Genesis service. */
export async function delegateAgentCreationFromBeacon(params: BeaconDelegateParams, options: BeaconDelegateOptions = {}) {
  const input = beaconDelegateInputSchema.parse(params.input);
  const { organization, scope, membership, user } = params;
  if (!organization.isActive) throw new BeaconDelegationError('organization is archived');
  if (scope.organizationKey !== organization.key || scope.deletedAt !== null) throw new BeaconDelegationError('target scope is unavailable');
  if (membership.status !== 'active' || membership.organizationId !== organization.key || membership.userId !== user.key) throw new BeaconDelegationError('active initiating membership was not verified');
  if (membership.orgRole !== 'owner') throw new BeaconDelegationError('organization owner role is required');

  const resolveAgent = options.resolveAgent ?? getAgentBySlug;
  const [beacon, genesis] = await Promise.all([resolveAgent(BEACON_AGENT_SLUG), resolveAgent('genesis')]);
  if (!beacon || beacon.name !== BEACON_AGENT_NAME || beacon.title !== BEACON_AGENT_TITLE) throw new BeaconDelegationError('canonical Beacon is unavailable');
  if (!genesis || genesis.slug !== 'genesis' || genesis.name !== 'Genesis' || genesis.title !== 'Agent Architect') throw new BeaconDelegationError('canonical Genesis is unavailable');
  const beaconRuntime = await loadAgentRuntime(beacon.key, options.runtimeData);
  const delegateGrant = beaconRuntime.tools.find(({ tool }) => tool.slug === BEACON_DELEGATE_TOOL_SLUG);
  if (!delegateGrant || delegateGrant.actions.length !== 1 || delegateGrant.actions[0]?.action.slug !== 'core.delegate') throw new BeaconDelegationError('Beacon has no canonical core.delegate grant');

  const runs = options.runs ?? getDefaultAgentRunRepository();
  const steps = options.steps ?? getDefaultAgentRunStepRepository();
  const recordEvent = options.events ?? recordRuntimeEvent;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const run = await runs.insertRun({ organizationKey: organization.key, scopeKey: scope.key, agentKey: beacon.key, principalType: 'member', userOrganizationKey: membership.key, status: 'accepted', reason: DELEGATE_REASON, score: 0, startedAt, endedAt: startedAt, elapsedMs: 0 });
  const stepKey = newId();
  const emit = (slug: Parameters<RuntimeEventRecorder>[0]['slug'], data: Parameters<RuntimeEventRecorder>[0]['data']) => recordEvent({ scopeId: scope.key, userId: user.key, slug, data });
  await emit('agent.started', { runKey: run.key, agentKey: beacon.key, status: 'started' });
  await emit('step.started', { runKey: run.key, stepKey, agentKey: beacon.key, status: 'started' });
  const delegateAction = delegateGrant.actions[0]!.action;
  const toolIdentity = { invocationKey: stepKey, agentKey: beacon.key, agentSlug: beacon.slug, agentName: beacon.name, toolKey: delegateGrant.tool.key, toolSlug: delegateGrant.tool.slug, toolName: delegateGrant.tool.name, actionKey: delegateAction.key, actionSlug: delegateAction.slug, actionName: delegateAction.name };
  await emit('tool.called', { runKey: run.key, stepKey, ...toolIdentity, status: 'called' });

  try {
    const create = options.createFromGenesis ?? createAgentFromGenesis;
    const genesisResult = await create({ organizationKey: organization.key, scopeKey: scope.key, genesisAgentKey: genesis.key, currentTask: input.request, requestedExplorationRate: input.requestedExplorationRate, sourceRefs: input.sourceRefs }, {
      ...options,
      principal: { kind: 'member', userOrganizationKey: membership.key },
      executionContext: { organization, scope },
      serviceDelegation: { agentSlug: 'genesis', requiredOrganizationRole: 'owner' },
    });
    const endedAtMs = Date.now(); const endedAt = new Date(endedAtMs).toISOString(); const elapsedMs = endedAtMs - startedAtMs;
    await steps.insertStep({ key: stepKey, agentRunKey: run.key, stepSlug: 'delegate-to-genesis', status: 'completed', startedAt, endedAt, elapsedMs });
    await runs.updateRun(run.key, { status: 'completed', reason: DELEGATE_REASON, score: genesisResult.persisted ? 1 : 0, endedAt, elapsedMs });
    await emit('tool.completed', { runKey: run.key, stepKey, ...toolIdentity, status: 'completed', elapsedMs });
    await emit('step.completed', { runKey: run.key, stepKey, agentKey: beacon.key, status: 'completed', elapsedMs });
    await emit('agent.completed', { runKey: run.key, agentKey: beacon.key, status: 'completed', elapsedMs });
    return { beaconRunKey: run.key, genesisRunKey: genesisResult.runKey, creation: genesisResult };
  } catch (error) {
    const endedAtMs = Date.now(); const endedAt = new Date(endedAtMs).toISOString(); const elapsedMs = endedAtMs - startedAtMs;
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await steps.insertStep({ key: stepKey, agentRunKey: run.key, stepSlug: 'delegate-to-genesis', status: 'failed', startedAt, endedAt, elapsedMs });
    await runs.updateRun(run.key, { status: 'failed', reason: DELEGATE_REASON, score: 0, endedAt, elapsedMs });
    await emit('tool.failed', { runKey: run.key, stepKey, ...toolIdentity, status: 'failed', reason, elapsedMs });
    await emit('step.failed', { runKey: run.key, stepKey, agentKey: beacon.key, status: 'failed', reason, elapsedMs });
    await emit('agent.failed', { runKey: run.key, agentKey: beacon.key, status: 'failed', reason, elapsedMs });
    throw error;
  }
}

export type BeaconAgentCreationDelegationResult = Awaited<ReturnType<typeof delegateAgentCreationFromBeacon>>;
