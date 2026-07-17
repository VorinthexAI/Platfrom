import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { db } from '@/lib/db/client';
import { toArangoDoc } from '@/lib/db/base';
import { embed } from '@/lib/embed';
import { newId } from '@/lib/ids';
import { AGENTS_COLLECTION, agentSchema, getAgentBySlug, type Agent } from '@/lib/db/agents.node';
import { AGENT_MEMBERS_COLLECTION, agentMemberSchema, type AgentMember } from '@/lib/db/agent-members.node';
import { SCOPE_AGENTS_COLLECTION, scopeAgentSchema, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { ORGANIZATIONS_COLLECTION, getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationByOrganizationAndUser, type UserOrganization } from '@/lib/db/user-organization.node';
import {
  SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  getDefaultScopeMemberRepository,
  getDefaultScopeRepository,
  type Scope,
  type ScopeMember,
} from '@/lib/ai/scopes';
import { canCreateAgent } from './authorization';
import { emitAgentAccessEvent, type AgentAccessEventEmitter } from './events';
import { resolveEffectiveScopeRole, roleAtLeast, roleRank, type RankedRole } from './roles';
import {
  createDefaultAgentAccessSyncDataSource,
  resolveEffectiveScopeMemberships,
  type AgentAccessSyncDataSource,
} from './sync';

export type AgentCreationDenialReason =
  | 'UNAUTHENTICATED'
  | 'ORGANIZATION_ACCESS_DENIED'
  | 'SCOPE_ACCESS_DENIED'
  | 'AGENT_CREATE_DENIED';

export class AgentCreationDeniedError extends AiError {
  constructor(readonly reason: AgentCreationDenialReason, detail: string) {
    super('agent_create_denied', `Agent creation denied: ${detail}`);
  }
}

export class AgentCreationConflictError extends AiError {
  constructor(slug: string) {
    super('agent_slug_conflict', `Agent slug ${slug} already exists`);
  }
}

export class AgentCreationInvariantError extends AiError {
  constructor(detail: string) {
    super('agent_creation_invariant_violated', `Agent creation aborted: ${detail}`);
  }
}

/**
 * The client provides only the manifest — never the creator role, threshold,
 * inherited member list, or any agentMembers rows. The backend derives all
 * authorization state.
 */
export const createAgentManifestSchema = agentSchema
  .omit({ key: true, embedding: true, scopeKey: true })
  .strict();
export type CreateAgentManifest = z.input<typeof createAgentManifestSchema>;

export interface CreateAgentAsMemberInput {
  userKey: string;
  organizationKey: string;
  scopeKey: string;
  manifest: CreateAgentManifest;
}

export const AGENT_CREATION_TRANSACTION_COLLECTIONS = {
  write: [AGENTS_COLLECTION, SCOPE_AGENTS_COLLECTION, AGENT_MEMBERS_COLLECTION],
  read: [ORGANIZATIONS_COLLECTION, SCOPES_COLLECTION, SCOPE_MEMBERS_COLLECTION],
} as const;
export type AgentCreationWriteCollection = typeof AGENT_CREATION_TRANSACTION_COLLECTIONS.write[number];

export interface AgentCreationTransactionWriter {
  save(collection: AgentCreationWriteCollection, document: Record<string, unknown> & { key: string }): Promise<void>;
}
export interface AgentCreationTransactionGateway {
  execute<T>(callback: (writer: AgentCreationTransactionWriter) => Promise<T>): Promise<T>;
}

export const arangoAgentCreationTransactionGateway: AgentCreationTransactionGateway = {
  async execute(callback) {
    const trx = await db.beginTransaction({
      write: [...AGENT_CREATION_TRANSACTION_COLLECTIONS.write],
      read: [...AGENT_CREATION_TRANSACTION_COLLECTIONS.read],
      exclusive: [...AGENT_CREATION_TRANSACTION_COLLECTIONS.write],
    });
    try {
      const result = await callback({
        async save(collection, document) { await trx.step(() => db.collection(collection).save(toArangoDoc(document))); },
      });
      await trx.commit();
      return result;
    } catch (error) {
      await trx.abort();
      throw error;
    }
  },
};

export interface CreateAgentAsMemberOptions {
  getUser?: (key: string) => Promise<User | null>;
  getOrganization?: (key: string) => Promise<Organization | null>;
  getMembership?: (organizationKey: string, userKey: string) => Promise<UserOrganization | null>;
  getScope?: (key: string) => Promise<Scope | null>;
  getScopeMember?: (scopeKey: string, userOrganizationKey: string) => Promise<ScopeMember | null>;
  findAgentBySlug?: (slug: string) => Promise<Agent | null>;
  sync?: AgentAccessSyncDataSource;
  transaction?: AgentCreationTransactionGateway;
  emitEvent?: AgentAccessEventEmitter;
}

export interface CreateAgentAsMemberResult {
  agent: Agent;
  scopeAgent: ScopeAgent;
  grants: readonly AgentMember[];
  creatorEffectiveRole: RankedRole;
}

/**
 * The one authorized, transactional agent-creation flow for human members:
 *
 *   resolve user → membership → organization access → scope access
 *   → effective role → creation permission → manifest validation
 *   → agent + scopeAgents(minimumAccessRole = creator role)
 *   → inherited agentMembers for every same-or-higher-role member
 *   → creator-access invariant → commit.
 *
 * The threshold is always derived from the creator's effective role — a
 * requested threshold from the client is ignored. Broader access is a later,
 * owner-gated management action. No agent ever exists in a partially
 * authorized state: any failed step aborts the whole transaction.
 */
export async function createAgentAsMember(
  input: CreateAgentAsMemberInput,
  options: CreateAgentAsMemberOptions = {},
): Promise<CreateAgentAsMemberResult> {
  const getUser = options.getUser ?? getUserById;
  const getOrganization = options.getOrganization ?? getOrganizationById;
  const getMembership = options.getMembership ?? getUserOrganizationByOrganizationAndUser;
  const getScope = options.getScope ?? ((key: string) => getDefaultScopeRepository().getScopeByKey(key));
  const getScopeMember = options.getScopeMember ?? (async (scopeKey: string, userOrganizationKey: string) => {
    const members = await getDefaultScopeMemberRepository().listMembers(scopeKey);
    return members.find((member) => member.userOrganizationKey === userOrganizationKey) ?? null;
  });
  const findAgentBySlug = options.findAgentBySlug ?? getAgentBySlug;
  const sync = options.sync ?? createDefaultAgentAccessSyncDataSource();
  const transaction = options.transaction ?? arangoAgentCreationTransactionGateway;
  const emitEvent = options.emitEvent ?? emitAgentAccessEvent;

  const user = await getUser(input.userKey);
  if (!user) throw new AgentCreationDeniedError('UNAUTHENTICATED', `user ${input.userKey} was not found`);
  const [organization, membership] = await Promise.all([
    getOrganization(input.organizationKey),
    getMembership(input.organizationKey, input.userKey),
  ]);
  if (!organization?.isActive || !membership || membership.status !== 'active') {
    throw new AgentCreationDeniedError('ORGANIZATION_ACCESS_DENIED', `user ${input.userKey} has no active membership in organization ${input.organizationKey}`);
  }

  const scope = await getScope(input.scopeKey);
  if (!scope || scope.organizationKey !== organization.key) {
    throw new AgentCreationDeniedError('SCOPE_ACCESS_DENIED', `scope ${input.scopeKey} is not accessible in organization ${organization.key}`);
  }
  const scopeMember = await getScopeMember(scope.key, membership.key);
  const effectiveRole = resolveEffectiveScopeRole({ userOrganization: membership, scopeMember });
  if (!effectiveRole) {
    throw new AgentCreationDeniedError('SCOPE_ACCESS_DENIED', `membership ${membership.key} has no access to scope ${scope.key}`);
  }
  if (!canCreateAgent({ effectiveRole })) {
    throw new AgentCreationDeniedError('AGENT_CREATE_DENIED', `effective role ${effectiveRole} may not create agents`);
  }

  const manifest = createAgentManifestSchema.parse(input.manifest);
  if (await findAgentBySlug(manifest.slug)) throw new AgentCreationConflictError(manifest.slug);

  // The inherited threshold is the creator's effective role, never a client choice.
  const minimumAccessRole = effectiveRole;
  const creatorRank = roleRank[effectiveRole];
  const eligible = (await resolveEffectiveScopeMemberships(scope, sync))
    .filter((candidate) => roleRank[candidate.effectiveRole] >= creatorRank);
  if (!eligible.some((candidate) => candidate.membership.key === membership.key)) {
    // Inconsistent membership state must abort rather than mint an agent its creator cannot use.
    throw new AgentCreationInvariantError(`creator membership ${membership.key} did not resolve as an eligible scope member`);
  }

  const now = new Date().toISOString();
  const agent = agentSchema.parse({
    ...manifest,
    key: newId(),
    scopeKey: scope.key,
    embedding: await embed({ text: [manifest.name, manifest.title].join('\n\n') }),
  });
  const scopeAgent = scopeAgentSchema.parse({
    key: newId(),
    scopeKey: scope.key,
    agentKey: agent.key,
    minimumAccessRole,
    createdByUserOrganizationKey: membership.key,
    createdAt: now,
    updatedAt: now,
  });
  const grants = eligible.map((candidate) => agentMemberSchema.parse({
    key: newId(),
    agentKey: agent.key,
    userOrganizationKey: candidate.membership.key,
    source: 'inherited',
    scopeAgentKey: scopeAgent.key,
    createdByUserOrganizationKey: null,
    createdAt: now,
  }));
  if (!grants.some((grant) => grant.userOrganizationKey === membership.key
    && roleAtLeast(effectiveRole, minimumAccessRole))) {
    throw new AgentCreationInvariantError('creator would not receive an effective grant');
  }

  await transaction.execute(async (writer) => {
    await writer.save(AGENTS_COLLECTION, agent);
    await writer.save(SCOPE_AGENTS_COLLECTION, scopeAgent);
    for (const grant of grants) await writer.save(AGENT_MEMBERS_COLLECTION, grant);
  });

  await emitEvent({
    scopeKey: scope.key,
    userId: user.key,
    slug: 'agent.created',
    data: { agentKey: agent.key, scopeAgentKey: scopeAgent.key, minimumAccessRole, createdCount: grants.length },
  });

  return { agent, scopeAgent, grants, creatorEffectiveRole: effectiveRole };
}
