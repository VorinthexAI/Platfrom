import { getAgentById, type Agent } from '@/lib/db/agents.node';
import { listAgentMembersByMembership, type AgentMember, type AgentMemberSource } from '@/lib/db/agent-members.node';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { listScopeAgentsByScope, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { getUserOrganizationByOrganizationAndUser, type UserOrganization } from '@/lib/db/user-organization.node';
import {
  getDefaultScopeMemberRepository,
  getDefaultScopeRepository,
  type Scope,
  type ScopeMember,
} from '@/lib/ai/scopes';
import { evaluateAgentAccess } from './authorization';

export interface AccessibleAgent {
  key: string;
  slug: string;
  name: string;
  title: string;
  scopeKey: string;
  accessSources: AgentMemberSource[];
}

export interface ListAccessibleAgentsInput {
  userKey: string;
  organizationKey: string;
  scopeKey: string;
}

export interface AccessibleAgentsDataSource {
  getOrganization(key: string): Promise<Organization | null>;
  getMembership(organizationKey: string, userKey: string): Promise<UserOrganization | null>;
  getScope(key: string): Promise<Scope | null>;
  getScopeMember(scopeKey: string, userOrganizationKey: string): Promise<ScopeMember | null>;
  listScopeAgents(scopeKey: string): Promise<readonly ScopeAgent[]>;
  getAgent(key: string): Promise<Agent | null>;
  listMembershipGrants(userOrganizationKey: string): Promise<readonly AgentMember[]>;
}

function createDefaultDataSource(): AccessibleAgentsDataSource {
  return {
    getOrganization: getOrganizationById,
    getMembership: getUserOrganizationByOrganizationAndUser,
    getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
    async getScopeMember(scopeKey, userOrganizationKey) {
      const members = await getDefaultScopeMemberRepository().listMembers(scopeKey);
      return members.find((member) => member.userOrganizationKey === userOrganizationKey) ?? null;
    },
    listScopeAgents: listScopeAgentsByScope,
    getAgent: getAgentById,
    listMembershipGrants: listAgentMembersByMembership,
  };
}

let cachedDefaultSource: AccessibleAgentsDataSource | null = null;

/**
 * Backend-authoritative "agents I can use in this scope" listing. Each
 * candidate runs through the canonical access evaluation, so restricted
 * system agents (explicit-grant policies) never leak into the list for
 * members who could not invoke them anyway.
 */
export async function listAccessibleAgents(
  input: ListAccessibleAgentsInput,
  source: AccessibleAgentsDataSource = (cachedDefaultSource ??= createDefaultDataSource()),
): Promise<AccessibleAgent[]> {
  const [organization, membership] = await Promise.all([
    source.getOrganization(input.organizationKey),
    source.getMembership(input.organizationKey, input.userKey),
  ]);
  if (!organization?.isActive || !membership || membership.status !== 'active') return [];
  const scope = await source.getScope(input.scopeKey);
  if (!scope || scope.organizationKey !== organization.key) return [];
  const scopeMember = await source.getScopeMember(scope.key, membership.key);

  const [links, grants] = await Promise.all([
    source.listScopeAgents(scope.key),
    source.listMembershipGrants(membership.key),
  ]);

  const accessible: AccessibleAgent[] = [];
  for (const scopeAgent of links) {
    const agent = await source.getAgent(scopeAgent.agentKey);
    if (!agent) continue;
    const decision = evaluateAgentAccess({
      organization,
      membership,
      scope,
      scopeMember,
      scopeAgent,
      agent,
      grants: grants.filter((grant) => grant.agentKey === agent.key),
    });
    if (!decision.allowed) continue;
    accessible.push({
      key: agent.key,
      slug: agent.slug,
      name: agent.name,
      title: agent.title,
      scopeKey: scope.key,
      accessSources: decision.grantSources,
    });
  }
  accessible.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
  return accessible;
}
