import { newId } from '@/lib/ids';
import { agentSchema, type Agent } from '@/lib/db/agents.node';
import { agentMemberSchema, type AgentMember, type AgentMemberSource } from '@/lib/db/agent-members.node';
import { organizationSchema, type Organization } from '@/lib/db/organizations.node';
import { scopeAgentSchema, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { userSchema, type User } from '@/lib/db/users.node';
import { userOrganizationSchema, type UserOrganization } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema, type Scope, type ScopeMember, type ScopeMemberRole } from '@/lib/ai/scopes';
import type { AgentAccessDataSource } from './authorization';
import type { AgentManagementDataSource } from './management';
import type { AgentAccessSyncDataSource } from './sync';
import type { AgentAccessEventEmitter } from './events';

export const FIXTURE_NOW = '2026-07-17T00:00:00.000Z';

export interface WorldMember {
  user: User;
  membership: UserOrganization;
  scopeMember: ScopeMember | null;
}

/**
 * A mutable in-memory authorization world implementing every agent-access
 * data-source interface, so tests can drive the real services end to end
 * without a database.
 */
export class AgentAccessWorld {
  readonly organization: Organization;
  readonly scope: Scope;
  readonly users: User[] = [];
  readonly memberships: UserOrganization[] = [];
  readonly scopeMembers: ScopeMember[] = [];
  readonly agents: Agent[] = [];
  readonly scopeAgents: ScopeAgent[] = [];
  grants: AgentMember[] = [];
  readonly events: Array<{ scopeKey: string; slug: string; data: Record<string, unknown> }> = [];

  constructor(input: { isRoot?: boolean } = {}) {
    this.organization = organizationSchema.parse({ key: newId(), name: 'Vorinthex', is_root: input.isRoot ?? false, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW });
    this.scope = scopeSchema.parse({ key: newId(), organizationKey: this.organization.key, slug: 'core', name: 'Core', description: 'Core scope', position: 1 });
  }

  addMember(orgRole: UserOrganization['orgRole'], scopeRole: ScopeMemberRole | null = null, status: 'active' | 'suspended' = 'active'): WorldMember {
    const user = userSchema.parse({ key: newId(), organizationId: this.organization.key, email: `${newId()}@example.com`, emailHash: newId(), createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW });
    const membership = userOrganizationSchema.parse({ key: newId(), organizationId: this.organization.key, userId: user.key, orgRole, status, joinedAt: FIXTURE_NOW, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW });
    const scopeMember = scopeRole
      ? scopeMemberSchema.parse({ key: newId(), scopeKey: this.scope.key, userOrganizationKey: membership.key, role: scopeRole })
      : null;
    this.users.push(user);
    this.memberships.push(membership);
    if (scopeMember) this.scopeMembers.push(scopeMember);
    return { user, membership, scopeMember };
  }

  setScopeRole(member: WorldMember, role: ScopeMemberRole | null) {
    const index = this.scopeMembers.findIndex((row) => row.userOrganizationKey === member.membership.key);
    if (index >= 0) this.scopeMembers.splice(index, 1);
    if (role) {
      this.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: this.scope.key, userOrganizationKey: member.membership.key, role }));
    }
  }

  setOrgRole(member: WorldMember, orgRole: UserOrganization['orgRole'], status: 'active' | 'suspended' = 'active') {
    const index = this.memberships.findIndex((row) => row.key === member.membership.key);
    this.memberships[index] = userOrganizationSchema.parse({ ...this.memberships[index]!, orgRole, status });
  }

  addAgent(input: { slug?: string; minimumAccessRole?: ScopeMemberRole; createdBy?: WorldMember | null } = {}): { agent: Agent; scopeAgent: ScopeAgent } {
    const agent = agentSchema.parse({ key: newId(), slug: input.slug ?? `agent-${this.agents.length + 1}`, name: 'Agent', title: 'Agent', scopeKey: this.scope.key });
    const scopeAgent = scopeAgentSchema.parse({
      key: newId(),
      scopeKey: this.scope.key,
      agentKey: agent.key,
      minimumAccessRole: input.minimumAccessRole ?? 'owner',
      createdByUserOrganizationKey: input.createdBy?.membership.key ?? null,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    });
    this.agents.push(agent);
    this.scopeAgents.push(scopeAgent);
    return { agent, scopeAgent };
  }

  addGrant(agent: Agent, scopeAgent: ScopeAgent, member: WorldMember, source: AgentMemberSource, grantedBy: WorldMember | null = null): AgentMember {
    const grant = agentMemberSchema.parse({
      key: newId(),
      agentKey: agent.key,
      userOrganizationKey: member.membership.key,
      source,
      scopeAgentKey: scopeAgent.key,
      createdByUserOrganizationKey: grantedBy?.membership.key ?? null,
      createdAt: FIXTURE_NOW,
    });
    this.grants.push(grant);
    return grant;
  }

  readonly emitEvent: AgentAccessEventEmitter = async (input) => {
    this.events.push({ scopeKey: input.scopeKey, slug: input.slug, data: input.data as Record<string, unknown> });
  };

  get access(): AgentAccessDataSource {
    return {
      getUser: async (key) => this.users.find((user) => user.key === key) ?? null,
      getMembership: async (organizationKey, userKey) => this.memberships.find((row) => row.organizationId === organizationKey && row.userId === userKey) ?? null,
      getOrganization: async (key) => (key === this.organization.key ? this.organization : null),
      getScope: async (key) => (key === this.scope.key ? this.scope : null),
      getScopeMember: async (scopeKey, membershipKey) => this.scopeMembers.find((row) => row.scopeKey === scopeKey && row.userOrganizationKey === membershipKey) ?? null,
      getScopeAgent: async (scopeKey, agentKey) => this.scopeAgents.find((row) => row.scopeKey === scopeKey && row.agentKey === agentKey) ?? null,
      getAgent: async (key) => this.agents.find((agent) => agent.key === key) ?? null,
      listGrants: async (agentKey, membershipKey) => this.grants.filter((grant) => grant.agentKey === agentKey && grant.userOrganizationKey === membershipKey),
    };
  }

  get sync(): AgentAccessSyncDataSource {
    return {
      getScopeAgent: async (key) => this.scopeAgents.find((row) => row.key === key) ?? null,
      listScopeAgents: async (scopeKey) => this.scopeAgents.filter((row) => row.scopeKey === scopeKey),
      getAgent: async (key) => this.agents.find((agent) => agent.key === key) ?? null,
      getScope: async (key) => (key === this.scope.key ? this.scope : null),
      getMembership: async (key) => this.memberships.find((row) => row.key === key) ?? null,
      listStewardMemberships: async (organizationKey) => this.memberships.filter((row) => row.organizationId === organizationKey && row.status === 'active' && (row.orgRole === 'owner' || row.orgRole === 'admin')),
      listScopeMemberships: async (scopeKey) => this.scopeMembers
        .filter((row) => row.scopeKey === scopeKey)
        .flatMap((scopeMember) => {
          const membership = this.memberships.find((row) => row.key === scopeMember.userOrganizationKey && row.status === 'active');
          return membership ? [{ scopeMember, membership }] : [];
        }),
      listInheritedGrants: async (scopeAgentKey) => this.grants.filter((grant) => grant.scopeAgentKey === scopeAgentKey && grant.source === 'inherited'),
      ensureInheritedGrant: async (input) => {
        const existing = this.grants.find((grant) => grant.agentKey === input.agentKey
          && grant.userOrganizationKey === input.userOrganizationKey
          && grant.source === 'inherited'
          && grant.scopeAgentKey === input.scopeAgentKey);
        if (existing) return existing;
        const grant = agentMemberSchema.parse({ key: newId(), ...input, source: 'inherited', createdByUserOrganizationKey: null, createdAt: FIXTURE_NOW });
        this.grants.push(grant);
        return grant;
      },
      deleteGrants: async (keys) => {
        this.grants = this.grants.filter((grant) => !keys.includes(grant.key));
      },
      deleteAllGrantsForMembership: async (membershipKey) => {
        const before = this.grants.length;
        this.grants = this.grants.filter((grant) => grant.userOrganizationKey !== membershipKey);
        return before - this.grants.length;
      },
      listOrganizationScopes: async (organizationKey) => (organizationKey === this.organization.key ? [this.scope] : []),
      emitEvent: this.emitEvent,
    };
  }

  get management(): AgentManagementDataSource {
    return {
      getUser: this.access.getUser,
      getOrganization: this.access.getOrganization,
      getMembership: this.access.getMembership,
      getMembershipByKey: async (key) => this.memberships.find((row) => row.key === key) ?? null,
      getScope: this.access.getScope,
      getScopeMember: this.access.getScopeMember,
      getScopeAgent: this.access.getScopeAgent,
      getAgent: this.access.getAgent,
      listGrants: this.access.listGrants,
      listAgentGrants: async (agentKey) => this.grants.filter((grant) => grant.agentKey === agentKey),
      ensureExplicitGrant: async (input) => {
        const existing = this.grants.find((grant) => grant.agentKey === input.agentKey
          && grant.userOrganizationKey === input.userOrganizationKey
          && grant.source === 'explicit'
          && grant.scopeAgentKey === input.scopeAgentKey);
        if (existing) return existing;
        const grant = agentMemberSchema.parse({ key: newId(), ...input, source: 'explicit', createdAt: FIXTURE_NOW });
        this.grants.push(grant);
        return grant;
      },
      deleteGrant: async (key) => {
        this.grants = this.grants.filter((grant) => grant.key !== key);
      },
      updateScopeAgentThreshold: async (scopeAgentKey, minimumAccessRole) => {
        const index = this.scopeAgents.findIndex((row) => row.key === scopeAgentKey);
        if (index < 0) throw new Error(`missing scopeAgent ${scopeAgentKey}`);
        this.scopeAgents[index] = scopeAgentSchema.parse({ ...this.scopeAgents[index]!, minimumAccessRole, updatedAt: FIXTURE_NOW });
        return this.scopeAgents[index]!;
      },
      sync: this.sync,
      emitEvent: this.emitEvent,
    };
  }
}
