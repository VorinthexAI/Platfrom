import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { organizationKeySchema } from '@/lib/ai/shared/ids';
import { db } from '@/lib/db/client';
import type { ResolvedExecutionPrincipal } from '@/lib/ai/agents/access';
import { accessRoleRank, type AccessRole } from '@/lib/ai/domain-tools/access-engine';
import { validateOrganizationStewardBindings } from '@/lib/ai/steward';
import { genesisCreationManifestSchema, genesisGuardrailsSchema } from './schemas';
import type { GenesisContext } from './context';
import { validateGenesisManifest, type ValidateGenesisManifestOptions, type ValidatedGenesisManifest } from './validation';
import { persistGenesisManifest, type GenesisTransactionGateway, type PersistGenesisManifestResult } from './persistence';

export const CREATE_AGENT_TOOL_SLUG = 'agent.create' as const;
export const CREATE_AGENT_ACTION_SLUG = 'agent.create' as const;

export const createAgentToolInputSchema = z.object({
  organizationKey: organizationKeySchema,
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
  scopeAgentKey: z.string().cuid().nullable(),
  agentMemberKeys: z.array(z.string().cuid()),
  artifactKeys: z.array(z.string().cuid()),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type CreateAgentToolOutput = z.infer<typeof createAgentToolOutputSchema>;

export class CreateAgentToolGuardrailError extends AiError {
  constructor(detail: string) { super('agent_create_guardrail_violation', `agent.create rejected the request: ${detail}`); }
}

export interface ExecuteCreateAgentToolOptions extends ValidateGenesisManifestOptions {
  transaction?: GenesisTransactionGateway;
  /** Trusted principal resolved by the persisted-agent runtime. */
  principal?: ResolvedExecutionPrincipal;
  placementResolver?: GenesisPlacementResolver;
  requestedMinimumAccessRole?: AccessRole;
  requiredProfile?: 'organization-steward';
}

export interface GenesisPlacementResolver {
  resolve(input: { organizationKey: string; scopeKey: string; minimumAccessRole: AccessRole; createdByUserOrganizationKey: string | null }): Promise<NonNullable<Parameters<typeof persistGenesisManifest>[0]['placement']>>;
}

const defaultPlacementResolver: GenesisPlacementResolver = {
  async resolve(input) {
    const [membershipsCursor, scopeMembersCursor, relationsCursor, positionsCursor] = await Promise.all([
      db.query<{ key: string; orgRole: string; status: string }>('FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey RETURN { key: membership._key, orgRole: membership.orgRole, status: membership.status }', { organizationKey: input.organizationKey }),
      db.query<{ userOrganizationKey: string; scopeKey: string; role: AccessRole; status: string }>('FOR member IN scopeMembers RETURN { userOrganizationKey: member.userOrganizationKey, scopeKey: member.scopeKey, role: member.role, status: member.status }'),
      db.query<{ parentKey: string; childKey: string }>('FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }'),
      db.query<number>('RETURN MAX(FOR relation IN scopeAgents FILTER relation.scopeKey == @scopeKey RETURN relation.position)', { scopeKey: input.scopeKey }),
    ]);
    const parentByChild = new Map((await relationsCursor.all()).map((relation) => [relation.childKey, relation.parentKey]));
    const ancestors = new Set([input.scopeKey]);
    let parent = parentByChild.get(input.scopeKey);
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
    const scopeMembers = (await scopeMembersCursor.all()).filter((member) => member.status === 'active' && ancestors.has(member.scopeKey));
    const inheritedUserOrganizationKeys = (await membershipsCursor.all()).filter((membership) => {
      if (membership.status !== 'active') return false;
      const organizationRole = membership.orgRole === 'member' ? 'viewer' : membership.orgRole as AccessRole;
      const scopeRole = scopeMembers.filter((member) => member.userOrganizationKey === membership.key).sort((a, b) => accessRoleRank[b.role] - accessRoleRank[a.role])[0]?.role;
      const effectiveRole = organizationRole === 'owner' || organizationRole === 'admin'
        ? organizationRole
        : scopeRole ?? null;
      return effectiveRole !== null && accessRoleRank[effectiveRole] >= accessRoleRank[input.minimumAccessRole];
    }).map(({ key }) => key);
    const maxPosition = await positionsCursor.next();
    return { ...input, position: (maxPosition ?? 0) + 1, inheritedUserOrganizationKeys };
  },
};
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

/** Local handler for the only write capability granted to Genesis. */
export async function executeCreateAgentTool(
  rawInput: CreateAgentToolInput,
  context: GenesisContext,
  options: ExecuteCreateAgentToolOptions = {},
): Promise<ExecuteCreateAgentToolResult> {
  // This parse is intentionally repeated at the local action boundary.
  const input = createAgentToolInputSchema.parse(rawInput);
  assertExecutionGuardrails(input, context);
  const validated = await validateGenesisManifest(input.manifest, context, input.agentRunKey, options);
  if (validated.manifest.metadata.status === 'rejected') {
    return {
      validated,
      output: createAgentToolOutputSchema.parse({
        status: 'rejected', agentKey: null, createdSkillKeys: [], reusedSkillKeys: [],
        agentSkillKeys: [], agentToolKeys: [], scopeAgentKey: null, agentMemberKeys: [], artifactKeys: [], reason: validated.manifest.metadata.reason,
      }),
    };
  }

  if (options.requiredProfile === 'organization-steward') {
    const issue = validateOrganizationStewardBindings({
      scopeKey: context.scope.key,
      tools: context.knowledge.existingTools,
      skills: context.knowledge.existingSkills,
      attachedToolKeys: validated.manifest.agentTools.map(({ toolKey }) => toolKey),
      skillOperations: validated.manifest.skills,
    });
    if (issue) throw new CreateAgentToolGuardrailError(issue);
  }

  const principal = options.principal;
  if (!principal) throw new CreateAgentToolGuardrailError('a server-resolved execution principal is required');
  const effectiveRole = principal.kind === 'system'
    ? 'owner'
    : principal.userOrganization.orgRole === 'owner' || principal.userOrganization.orgRole === 'admin'
      ? principal.userOrganization.orgRole
      : principal.scopeMember?.role ?? 'viewer';
  if (principal.kind === 'member' && effectiveRole !== 'owner' && effectiveRole !== 'admin') {
    throw new CreateAgentToolGuardrailError('only an owner or admin may create an agent');
  }
  const minimumAccessRole = options.requestedMinimumAccessRole ?? effectiveRole;
  if (principal.kind === 'member' && effectiveRole !== 'owner' && accessRoleRank[minimumAccessRole] < accessRoleRank[effectiveRole]) {
    throw new CreateAgentToolGuardrailError('only an owner may lower agent access below the creator role');
  }
  const placement = validated.manifest.agent.operation === 'create'
    ? await (options.placementResolver ?? defaultPlacementResolver).resolve({
      organizationKey: input.organizationKey,
      scopeKey: input.scopeKey,
      minimumAccessRole,
      createdByUserOrganizationKey: principal.kind === 'member' ? principal.userOrganization.key : null,
    })
    : undefined;
  if (principal.kind === 'member' && placement && !placement.inheritedUserOrganizationKeys.includes(principal.userOrganization.key)) {
    throw new CreateAgentToolGuardrailError('creator is not eligible for the derived agent access threshold');
  }
  const persisted = await persistGenesisManifest({ runKey: input.agentRunKey, context, validated, placement }, options.transaction);
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
      scopeAgentKey: persisted.scopeAgent?.key ?? null,
      agentMemberKeys: persisted.agentMembers.map(({ key }) => key),
      artifactKeys: persisted.artifacts.map(({ key }) => key),
      reason: validated.manifest.metadata.reason,
    }),
  };
}
