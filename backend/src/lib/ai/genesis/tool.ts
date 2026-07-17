import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getUserOrganizationById, type UserOrganization } from '@/lib/db/user-organization.node';
import type { ExecutionPrincipal } from '@/lib/ai/agents/access';
import { canCreateAgent } from '@/lib/ai/agent-access/authorization';
import { resolveEffectiveScopeRole, roleRank } from '@/lib/ai/agent-access/roles';
import {
  createDefaultAgentAccessSyncDataSource,
  resolveEffectiveScopeMemberships,
  type AgentAccessSyncDataSource,
} from '@/lib/ai/agent-access/sync';
import { genesisCreationManifestSchema, genesisGuardrailsSchema } from './schemas';
import type { GenesisContext } from './context';
import { validateGenesisManifest, type ValidateGenesisManifestOptions, type ValidatedGenesisManifest } from './validation';
import {
  persistGenesisManifest,
  SYSTEM_GENESIS_ACCESS_PLAN,
  type GenesisAgentAccessPlan,
  type GenesisTransactionGateway,
  type PersistGenesisManifestResult,
} from './persistence';

export const CREATE_AGENT_TOOL_SLUG = 'agent.create' as const;
export const CREATE_AGENT_ACTION_SLUG = 'agent.create' as const;

export const createAgentToolInputSchema = z.object({
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  manifest: genesisCreationManifestSchema,
}).strict();
export type CreateAgentToolInput = z.input<typeof createAgentToolInputSchema>;

export const createAgentToolOutputSchema = z.object({
  status: z.enum(['created', 'reused', 'rejected']),
  agentKey: z.string().cuid().nullable(),
  createdSkillKeys: z.array(z.string().cuid()),
  reusedSkillKeys: z.array(z.string().cuid()),
  agentSkillKeys: z.array(z.string().cuid()),
  agentToolKeys: z.array(z.string().cuid()),
  artifactKeys: z.array(z.string().cuid()),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type CreateAgentToolOutput = z.infer<typeof createAgentToolOutputSchema>;

export class CreateAgentToolGuardrailError extends AiError {
  constructor(detail: string) { super('agent_create_guardrail_violation', `agent.create rejected the request: ${detail}`); }
}

export interface ExecuteCreateAgentToolOptions extends ValidateGenesisManifestOptions {
  transaction?: GenesisTransactionGateway;
  /** The principal that initiated the Genesis run — the authorization principal for the created agent. */
  principal?: ExecutionPrincipal;
  accessSync?: AgentAccessSyncDataSource;
  getMembership?: (key: string) => Promise<UserOrganization | null>;
}
export interface ExecuteCreateAgentToolResult {
  output: CreateAgentToolOutput;
  validated: ValidatedGenesisManifest;
  persisted?: PersistGenesisManifestResult;
}

function assertExecutionGuardrails(input: z.infer<typeof createAgentToolInputSchema>, context: GenesisContext) {
  const guardrails = genesisGuardrailsSchema.parse(context.guardrails);
  if (input.organizationKey !== context.organization.key || guardrails.organizationKey !== input.organizationKey) {
    throw new CreateAgentToolGuardrailError('organization does not match the compiled Genesis context');
  }
  if (input.scopeKey !== context.scope.key || guardrails.scopeKey !== input.scopeKey) {
    throw new CreateAgentToolGuardrailError('scope does not match the compiled Genesis context');
  }
  if (context.scope.organizationKey !== input.organizationKey) {
    throw new CreateAgentToolGuardrailError('target scope belongs to another organization');
  }
  const grant = context.tools.find(({ tool }) => tool.slug === CREATE_AGENT_TOOL_SLUG);
  if (context.tools.length !== 1 || !grant || grant.actions.length !== 1 || grant.actions[0]?.action.slug !== CREATE_AGENT_ACTION_SLUG) {
    throw new CreateAgentToolGuardrailError('Genesis must own only agent.create mapped only to agent.create');
  }
}

/**
 * Derives the created agent's access plan from the INITIATING HUMAN when one
 * exists. Genesis is the executing agent, not the authorization principal:
 * a moderator asking Genesis for an agent yields a moderator threshold —
 * never owner, system, or Genesis's own authority. The human must also hold
 * creation permission in the target scope, or the whole run is rejected.
 */
async function resolveGenesisAccessPlan(
  context: GenesisContext,
  options: ExecuteCreateAgentToolOptions,
): Promise<GenesisAgentAccessPlan> {
  const principal = options.principal;
  if (!principal || principal.kind === 'system') return SYSTEM_GENESIS_ACCESS_PLAN;
  const getMembership = options.getMembership ?? getUserOrganizationById;
  const sync = options.accessSync ?? createDefaultAgentAccessSyncDataSource();
  const membership = await getMembership(principal.userOrganizationKey);
  if (!membership || membership.status !== 'active' || membership.organizationId !== context.organization.key) {
    throw new CreateAgentToolGuardrailError('initiating membership has no active membership in the target organization');
  }
  const scopeMemberships = await resolveEffectiveScopeMemberships(context.scope, sync);
  const creator = scopeMemberships.find((candidate) => candidate.membership.key === membership.key);
  const effectiveRole = creator?.effectiveRole
    ?? resolveEffectiveScopeRole({ userOrganization: membership, scopeMember: null });
  if (!effectiveRole) {
    throw new CreateAgentToolGuardrailError('initiating membership has no access to the target scope');
  }
  if (!canCreateAgent({ effectiveRole })) {
    throw new CreateAgentToolGuardrailError(`initiating role ${effectiveRole} may not create agents`);
  }
  const creatorRank = roleRank[effectiveRole];
  const inheritedMembershipKeys = scopeMemberships
    .filter((candidate) => roleRank[candidate.effectiveRole] >= creatorRank)
    .map((candidate) => candidate.membership.key);
  if (!inheritedMembershipKeys.includes(membership.key)) {
    throw new CreateAgentToolGuardrailError('initiating membership did not resolve as an eligible scope member');
  }
  return {
    createdByUserOrganizationKey: membership.key,
    minimumAccessRole: effectiveRole,
    inheritedMembershipKeys,
  };
}

/** Local handler for the only write capability granted to Genesis. */
export async function executeCreateAgentTool(
  rawInput: CreateAgentToolInput,
  context: GenesisContext,
  options: ExecuteCreateAgentToolOptions = {},
): Promise<ExecuteCreateAgentToolResult> {
  // This parse is intentionally repeated at the local action boundary.
  const input = createAgentToolInputSchema.parse(rawInput);
  assertExecutionGuardrails(input, context);
  const access = await resolveGenesisAccessPlan(context, options);
  const validated = await validateGenesisManifest(input.manifest, context, input.agentRunKey, options);
  if (validated.manifest.metadata.status === 'rejected') {
    return {
      validated,
      output: createAgentToolOutputSchema.parse({
        status: 'rejected', agentKey: null, createdSkillKeys: [], reusedSkillKeys: [],
        agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: validated.manifest.metadata.reason,
      }),
    };
  }

  const persisted = await persistGenesisManifest({ runKey: input.agentRunKey, context, validated, access }, options.transaction);
  return {
    validated,
    persisted,
    output: createAgentToolOutputSchema.parse({
      status: validated.manifest.agent.operation === 'reuse' ? 'reused' : 'created',
      agentKey: persisted.agent.key,
      createdSkillKeys: persisted.createdSkills.map(({ key }) => key),
      reusedSkillKeys: validated.manifest.skills.flatMap((skill) => skill.operation === 'reuse' ? [skill.skillKey] : []),
      agentSkillKeys: persisted.agentSkills.map(({ key }) => key),
      agentToolKeys: persisted.agentTools.map(({ key }) => key),
      artifactKeys: persisted.artifacts.map(({ key }) => key),
      reason: validated.manifest.metadata.reason,
    }),
  };
}
