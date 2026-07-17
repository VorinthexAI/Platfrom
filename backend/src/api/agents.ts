import type { Context } from 'hono';
import { z } from 'zod';
import {
  AgentCreationConflictError,
  AgentCreationDeniedError,
  AgentCreationInvariantError,
  AgentManagementDeniedError,
  canUserAccessAgent,
  createAgentAsMember,
  createAgentManifestSchema,
  grantExplicitAgentAccess,
  listAccessibleAgents,
  listAgentMemberAccess,
  revokeExplicitAgentAccess,
  updateAgentAccessThreshold,
  type AgentAccessDenialReason,
  type AgentCreationDenialReason,
  type AgentManagementDenialReason,
} from '@/lib/ai/agent-access';
import { scopeMemberRoleSchema } from '@/lib/ai/scopes';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { runStoredAgentTool } from '@/lib/ai/pipeline';
import { InvalidRunRequestError } from '@/lib/ai/pipeline/validation';
import { loadAgentRuntime, AgentRuntimeNotFoundError, AgentRuntimeInvalidError } from '@/lib/ai/agents/runtime';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

/**
 * Agent access management and execution endpoints. Route parameters name the
 * organization, scope, and agent; the caller's user, role, grants, and every
 * authorization decision resolve exclusively server-side through the
 * canonical agent-access services. Denials use stable codes: 401
 * unauthenticated, 403 authenticated-but-denied, and 404 where resource
 * existence must stay hidden.
 */

const cuidParamSchema = z.string().cuid();
// Root organization keys predate CUIDs, so organization params stay loose.
const organizationKeyParamSchema = z.string().trim().min(1).max(120);

const MAX_AGENT_INPUT = 20_000;

const createAgentBodySchema = strictObject({ manifest: createAgentManifestSchema });
const grantAgentMemberBodySchema = strictObject({ userOrganizationKey: z.string().cuid() });
const accessThresholdBodySchema = strictObject({ minimumAccessRole: scopeMemberRoleSchema });
const runAgentBodySchema = strictObject({ input: z.string().trim().min(1).max(MAX_AGENT_INPUT) });

interface RouteContext {
  userKey: string;
  organizationKey: string;
  scopeKey: string;
}

async function requireRouteContext(c: Context): Promise<RouteContext | Response> {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ error: 'authentication required', code: 'UNAUTHENTICATED' }, 401);
  const organizationKey = organizationKeyParamSchema.safeParse(c.req.param('organizationKey'));
  const scopeKey = cuidParamSchema.safeParse(c.req.param('scopeKey'));
  if (!organizationKey.success || !scopeKey.success) {
    return c.json({ error: 'invalid organization or scope key', code: 'VALIDATION_ERROR' }, 400);
  }
  return { userKey: identity.key, organizationKey: organizationKey.data, scopeKey: scopeKey.data };
}

function agentKeyParam(c: Context): string | Response {
  const parsed = cuidParamSchema.safeParse(c.req.param('agentKey'));
  if (!parsed.success) return c.json({ error: 'invalid agent key', code: 'VALIDATION_ERROR' }, 400);
  return parsed.data;
}

type DenialCode = AgentAccessDenialReason | AgentCreationDenialReason | AgentManagementDenialReason | 'AGENT_CREATE_DENIED';

/**
 * 401 for unauthenticated, 404 where existence hiding applies (an agent the
 * caller cannot invoke must be indistinguishable from one that does not
 * exist — this is what keeps restricted system agents invisible), and 403
 * for organization/scope/management denials the caller may know about.
 */
function denialResponse(c: Context, code: DenialCode): Response {
  if (code === 'UNAUTHENTICATED') return c.json({ error: 'authentication required', code }, 401);
  if (code === 'AGENT_NOT_IN_SCOPE' || code === 'AGENT_UNAVAILABLE' || code === 'AGENT_ACCESS_DENIED') {
    return c.json({ error: 'agent not found', code }, 404);
  }
  return c.json({ error: 'access denied', code }, 403);
}

function managementError(c: Context, error: unknown): Response {
  if (error instanceof AgentManagementDeniedError) return denialResponse(c, error.reason);
  throw error;
}

/** POST /organizations/:organizationKey/scopes/:scopeKey/agents — authorized transactional creation. */
export async function createScopedAgent(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const body = await parseJson(c, createAgentBodySchema);
  try {
    const result = await createAgentAsMember({
      userKey: route.userKey,
      organizationKey: route.organizationKey,
      scopeKey: route.scopeKey,
      manifest: body.manifest,
    });
    return c.json({
      agent: {
        key: result.agent.key,
        slug: result.agent.slug,
        name: result.agent.name,
        title: result.agent.title,
        scopeKey: result.agent.scopeKey,
      },
      minimumAccessRole: result.scopeAgent.minimumAccessRole,
      inheritedMemberCount: result.grants.length,
    }, 201);
  } catch (error) {
    if (error instanceof AgentCreationDeniedError) return denialResponse(c, error.reason);
    if (error instanceof AgentCreationConflictError) return c.json({ error: 'agent slug already exists', code: 'AGENT_SLUG_CONFLICT' }, 409);
    if (error instanceof AgentCreationInvariantError) return c.json({ error: 'agent creation aborted', code: 'AGENT_CREATE_DENIED' }, 409);
    throw error;
  }
}

/** GET /organizations/:organizationKey/scopes/:scopeKey/agents — only agents the caller can invoke. */
export async function listScopedAgents(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agents = await listAccessibleAgents({
    userKey: route.userKey,
    organizationKey: route.organizationKey,
    scopeKey: route.scopeKey,
  });
  return c.json({ agents });
}

/** GET .../agents/:agentKey/members — the inherited/explicit/effective access table. */
export async function listScopedAgentMembers(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agentKey = agentKeyParam(c);
  if (agentKey instanceof Response) return agentKey;
  try {
    const result = await listAgentMemberAccess({
      actorUserKey: route.userKey,
      organizationKey: route.organizationKey,
      scopeKey: route.scopeKey,
      agentKey,
    });
    return c.json(result);
  } catch (error) {
    return managementError(c, error);
  }
}

/** POST .../agents/:agentKey/members — explicit grant; the server always sets source=explicit. */
export async function grantScopedAgentMember(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agentKey = agentKeyParam(c);
  if (agentKey instanceof Response) return agentKey;
  const body = await parseJson(c, grantAgentMemberBodySchema);
  try {
    const result = await grantExplicitAgentAccess({
      actorUserKey: route.userKey,
      organizationKey: route.organizationKey,
      scopeKey: route.scopeKey,
      agentKey,
      targetUserOrganizationKey: body.userOrganizationKey,
    });
    return c.json({
      granted: true,
      alreadyGranted: result.alreadyGranted,
      userOrganizationKey: result.grant.userOrganizationKey,
      source: result.grant.source,
    }, result.alreadyGranted ? 200 : 201);
  } catch (error) {
    return managementError(c, error);
  }
}

/** DELETE .../agents/:agentKey/members/:userOrganizationKey — removes only the explicit grant. */
export async function revokeScopedAgentMember(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agentKey = agentKeyParam(c);
  if (agentKey instanceof Response) return agentKey;
  const target = cuidParamSchema.safeParse(c.req.param('userOrganizationKey'));
  if (!target.success) return c.json({ error: 'invalid membership key', code: 'VALIDATION_ERROR' }, 400);
  try {
    const result = await revokeExplicitAgentAccess({
      actorUserKey: route.userKey,
      organizationKey: route.organizationKey,
      scopeKey: route.scopeKey,
      agentKey,
      targetUserOrganizationKey: target.data,
    });
    return c.json(result);
  } catch (error) {
    return managementError(c, error);
  }
}

/** PATCH .../agents/:agentKey/access-threshold — owner-gated; runs full synchronization. */
export async function updateScopedAgentAccessThreshold(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agentKey = agentKeyParam(c);
  if (agentKey instanceof Response) return agentKey;
  const body = await parseJson(c, accessThresholdBodySchema);
  try {
    const result = await updateAgentAccessThreshold({
      actorUserKey: route.userKey,
      organizationKey: route.organizationKey,
      scopeKey: route.scopeKey,
      agentKey,
      minimumAccessRole: body.minimumAccessRole,
    });
    return c.json({
      minimumAccessRole: result.scopeAgent.minimumAccessRole,
      inheritedGrantsCreated: result.createdCount,
      inheritedGrantsRemoved: result.removedCount,
    });
  } catch (error) {
    return managementError(c, error);
  }
}

const RUN_AGENT_TIMEOUT_MS = 120_000;

/**
 * POST .../agents/:agentKey/run — one authorized run of the agent's primary
 * tool. canUserAccessAgent gates before anything loads, and run creation
 * re-authorizes through the same canonical execution check, so no AgentRun
 * reaches accepted/running state without an authorization decision.
 */
export async function runScopedAgent(c: Context) {
  const route = await requireRouteContext(c);
  if (route instanceof Response) return route;
  const agentKey = agentKeyParam(c);
  if (agentKey instanceof Response) return agentKey;
  const body = await parseJson(c, runAgentBodySchema);

  const decision = await canUserAccessAgent({
    userKey: route.userKey,
    organizationKey: route.organizationKey,
    scopeKey: route.scopeKey,
    agentKey,
  });
  if (!decision.allowed) return denialResponse(c, decision.reason);

  try {
    const runtime = await loadAgentRuntime(agentKey);
    const primaryTool = runtime.tools[0];
    if (!primaryTool) return c.json({ error: 'agent has no runnable tool', code: 'AGENT_UNAVAILABLE' }, 409);
    const result = await runStoredAgentTool({
      organizationKey: runtime.organization.key,
      agentKey,
      toolKey: primaryTool.tool.key,
      stepSlug: 'run-agent',
      metadata: { status: 'accepted', reason: 'Direct authorized agent run', score: 1 },
      input: { messages: [{ role: 'user', content: body.input }] },
      currentTask: body.input,
      outputSchema: 'Return {"status","reason","score"} metadata plus a "text" field containing the user-facing answer.',
    }, {
      principal: { kind: 'member', userOrganizationKey: decision.userOrganizationKey },
      timeoutMs: RUN_AGENT_TIMEOUT_MS,
    });
    return c.json({
      runKey: result.run.key,
      status: result.run.status,
      output: result.executed ? result.response.output : null,
    }, 201);
  } catch (error) {
    if (error instanceof AgentExecutionAccessError) return denialResponse(c, error.reason);
    if (error instanceof InvalidRunRequestError) return c.json({ error: 'invalid run request', code: 'VALIDATION_ERROR' }, 400);
    if (error instanceof AgentRuntimeNotFoundError || error instanceof AgentRuntimeInvalidError) {
      return c.json({ error: 'agent not found', code: 'AGENT_UNAVAILABLE' }, 404);
    }
    throw error;
  }
}
