import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { agentOutputMetadataSchema } from '@/lib/ai/agent-runs';
import { getAgentBySlug, loadAgentRuntime, type Agent } from '@/lib/ai/agents';
import { runStoredAgentTool, type RunStoredAgentToolOptions, type StoredAgentRunResult } from '@/lib/ai/pipeline';
import type { Organization } from '@/lib/db/organizations.node';
import type { User } from '@/lib/db/users.node';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { Scope } from '@/lib/ai/scopes';
import { recordRuntimeEvent, type RuntimeEventRecorder } from '@/platform/events';
import { BEACON_AGENT_NAME, BEACON_AGENT_SLUG, BEACON_AGENT_TITLE, BEACON_DELEGATE_TOOL_SLUG } from './seed';
import { delegateAgentCreationFromBeacon, type BeaconAgentCreationDelegationResult, type BeaconDelegateOptions } from './delegate';
import { AsyncEventChannel, createBeaconToolActivityProjector, type BeaconToolActivity } from './tool-activity';

export const BEACON_ASK_MAX_MESSAGE_LENGTH = 20_000;
export const BEACON_NO_DELEGATE_MESSAGE = 'No eligible specialist agent is available for this request.';
export const beaconAskMessageSchema = z.string().trim().min(1).max(BEACON_ASK_MAX_MESSAGE_LENGTH);

const noDelegateDecisionSchema = z.object({
  target: z.literal('none'),
  reason: z.literal('NO_ELIGIBLE_DELEGATE'),
}).strict();

const genesisDecisionSchema = z.object({
  target: z.literal('genesis'),
  operation: z.literal('agent.create'),
  request: z.string().trim().min(1).max(BEACON_ASK_MAX_MESSAGE_LENGTH),
}).strict();

export const beaconDelegationDecisionSchema = z.object({
  metadata: agentOutputMetadataSchema,
  delegation: z.discriminatedUnion('target', [genesisDecisionSchema, noDelegateDecisionSchema]),
}).strict();
export type BeaconDelegationDecision = z.infer<typeof beaconDelegationDecisionSchema>;

/** Server-owned specialist allowlist. Adding an agent requires a matching local executor and Zod branch. */
export const BEACON_DELEGATE_REGISTRY = [{
  agentSlug: 'genesis',
  operation: 'agent.create',
  description: 'Create or design a new agent architecture.',
}] as const;

export const BEACON_DELEGATION_OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['metadata', 'delegation'],
  properties: {
    metadata: {
      type: 'object', additionalProperties: false, required: ['status', 'reason', 'score'],
      properties: { status: { enum: ['accepted', 'rejected'] }, reason: { type: 'string', description: 'At most ten words.' }, score: { type: 'number', minimum: 0, maximum: 1 } },
    },
    delegation: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['target', 'operation', 'request'], properties: { target: { const: 'genesis' }, operation: { const: 'agent.create' }, request: { type: 'string' } } },
        { type: 'object', additionalProperties: false, required: ['target', 'reason'], properties: { target: { const: 'none' }, reason: { const: 'NO_ELIGIBLE_DELEGATE' } } },
      ],
    },
  },
});

const BEACON_DELEGATION_PROMPT = `Select exactly one server-allowed specialist. Never answer the user.

Allowed specialists:
${BEACON_DELEGATE_REGISTRY.map((entry) => `- ${entry.agentSlug}: operation ${entry.operation}; ${entry.description}`).join('\n')}

Every other request, including questions about organizations, scopes, members, agents, providers, access, or general knowledge, must select target "none" with reason "NO_ELIGIBLE_DELEGATE". Return only the required JSON object with no extra fields.`;

export class BeaconUnavailableError extends AiError {
  constructor(detail: string) { super('beacon_unavailable', `Beacon is unavailable: ${detail}`); }
}

export class BeaconAskRequestError extends AiError {
  constructor(detail: string) { super('beacon_ask_invalid', `Invalid Beacon ask: ${detail}`); }
}

export interface BeaconAskParams {
  organization: Organization;
  scope: Scope;
  membership: UserOrganization;
  user: User;
  message: string;
}

export interface BeaconAskOptions extends BeaconDelegateOptions {
  getAgent?: (slug: string) => Promise<Agent | null>;
  runTool?: typeof runStoredAgentTool;
  delegateCreation?: typeof delegateAgentCreationFromBeacon;
}

export type BeaconAskEvent =
  | { type: 'started'; runKey: string }
  | { type: 'tool'; activity: BeaconToolActivity }
  | { type: 'delta'; text: string }
  | { type: 'completed'; runKey: string };

function assertRequest(params: BeaconAskParams) {
  const { organization, scope, membership, user } = params;
  if (!organization.isActive) throw new BeaconAskRequestError('organization is archived');
  if (scope.deletedAt !== null) throw new BeaconAskRequestError('scope is archived');
  if (membership.status !== 'active') throw new BeaconAskRequestError('membership is not active');
  if (membership.userId !== user.key) throw new BeaconAskRequestError('membership does not belong to the user');
  if (membership.organizationId !== organization.key) throw new BeaconAskRequestError('membership belongs to another organization');
  if (scope.organizationKey !== organization.key) throw new BeaconAskRequestError('scope belongs to another organization');
}

/**
 * Beacon's conversational entry point is delegation-only. The model may
 * produce only a strict allow-list decision; user-facing prose can come only
 * from a selected specialist or the server-owned no-delegate message.
 */
export async function* streamFoundersBeaconAsk(params: BeaconAskParams, options: BeaconAskOptions = {}): AsyncGenerator<BeaconAskEvent> {
  const message = beaconAskMessageSchema.parse(params.message);
  assertRequest(params);
  const getAgent = options.getAgent ?? getAgentBySlug;
  const beacon = await getAgent(BEACON_AGENT_SLUG);
  if (!beacon || beacon.name !== BEACON_AGENT_NAME || beacon.title !== BEACON_AGENT_TITLE) throw new BeaconUnavailableError('the canonical Beacon agent is not registered');
  const runtime = await loadAgentRuntime(beacon.key, options.runtimeData);
  const grant = runtime.tools.find(({ tool }) => tool.slug === BEACON_DELEGATE_TOOL_SLUG);
  const action = grant?.actions[0];
  if (runtime.tools.length !== 1 || !grant || grant.actions.length !== 1 || !action) {
    throw new BeaconUnavailableError('Beacon must have core.delegate as its only tool');
  }

  const outcome: { decision?: BeaconDelegationDecision; delegated?: BeaconAgentCreationDelegationResult } = {};
  const channel = new AsyncEventChannel<BeaconAskEvent>();
  const projectToolActivity = createBeaconToolActivityProjector();
  const persistedEvents = options.events ?? recordRuntimeEvent;
  let started = false;
  const liveEvents: RuntimeEventRecorder = async (event) => {
    if (!started && event.slug === 'agent.started' && event.data.runKey) {
      started = true;
      channel.push({ type: 'started', runKey: event.data.runKey });
    }
    const activity = projectToolActivity(event);
    if (activity) channel.push({ type: 'tool', activity });
    await persistedEvents(event);
  };
  const runTool = options.runTool ?? runStoredAgentTool;
  const execution = Promise.resolve(runTool({
    organizationKey: params.organization.key,
    agentKey: beacon.key,
    toolKey: grant.tool.key,
    actionKey: action.action.key,
    stepSlug: 'select-delegate',
    metadata: { status: 'accepted', reason: 'Select an allowed specialist', score: 1 },
    input: { messages: [{ role: 'user', content: message }], system: BEACON_DELEGATION_PROMPT },
    currentTask: message,
    outputSchema: BEACON_DELEGATION_OUTPUT_SCHEMA,
  }, {
    ...options,
    events: liveEvents,
    principal: { kind: 'member', userOrganizationKey: params.membership.key },
    executionContext: { organization: params.organization, scope: params.scope },
    serviceDelegation: { agentSlug: 'beacon', requiredOrganizationRole: null },
    reasoningActionSlug: 'core.reason',
    allowRejectedOutput: true,
    beforeFinalize: async ({ response }) => {
      const parsedDecision = beaconDelegationDecisionSchema.parse(response.output);
      outcome.decision = parsedDecision;
      if (parsedDecision.delegation.target === 'genesis') {
        const delegateCreation = options.delegateCreation ?? delegateAgentCreationFromBeacon;
        outcome.delegated = await delegateCreation(
          { ...params, input: { request: parsedDecision.delegation.request } },
          { ...options, events: liveEvents },
        );
      }
    },
  } as RunStoredAgentToolOptions) as Promise<StoredAgentRunResult<BeaconDelegationDecision>>)
    .finally(() => channel.close());

  let result: StoredAgentRunResult<BeaconDelegationDecision>;
  try {
    for await (const event of channel) yield event;
    result = await execution;
  } finally {
    // A disconnected SSE consumer returns the generator early. Always observe
    // the execution promise so an abort cannot become an unhandled rejection.
    await execution.catch(() => undefined);
  }

  if (!result.executed || !outcome.decision) throw new BeaconUnavailableError('delegation decision was not executed');
  const runKey = result.run.key;
  if (!started) yield { type: 'started', runKey };
  if (outcome.decision.delegation.target === 'none') {
    yield { type: 'delta', text: BEACON_NO_DELEGATE_MESSAGE };
  } else {
    if (!outcome.delegated) throw new BeaconUnavailableError('Genesis delegation did not complete');
    const status = outcome.delegated.creation.toolOutput.status;
    yield { type: 'delta', text: status === 'created' ? 'Genesis created the requested agent architecture.' : 'Genesis could not create the requested agent architecture.' };
  }
  yield { type: 'completed', runKey };
}
