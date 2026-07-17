import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { canCreateAgent, canManageAgentMembers, canUpdateAccessThreshold, canUserAccessAgent } from './authorization';
import { AgentAccessWorld } from './test-fixtures';

describe('canUserAccessAgent', () => {
  test('allows a member whose valid inherited grant matches the threshold', async () => {
    const world = new AgentAccessWorld();
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, moderator, 'inherited');
    const decision = await canUserAccessAgent({ userKey: moderator.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(decision).toEqual({
      allowed: true,
      userOrganizationKey: moderator.membership.key,
      effectiveRole: 'moderator',
      scopeAgentKey: scopeAgent.key,
      grantSources: ['inherited'],
    });
  });

  test('organization membership alone never grants agent access', async () => {
    const world = new AgentAccessWorld();
    const orgMember = world.addMember('member', null);
    const { agent } = world.addAgent({ minimumAccessRole: 'viewer' });
    const decision = await canUserAccessAgent({ userKey: orgMember.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(decision).toEqual({ allowed: false, reason: 'SCOPE_ACCESS_DENIED' });
  });

  test('scope membership without a grant is denied', async () => {
    const world = new AgentAccessWorld();
    const viewer = world.addMember('member', 'viewer');
    const { agent } = world.addAgent({ minimumAccessRole: 'viewer' });
    const decision = await canUserAccessAgent({ userKey: viewer.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(decision).toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });
  });

  test('a grant without scope access is denied (stale agentMembers rows never win)', async () => {
    const world = new AgentAccessWorld();
    const removed = world.addMember('member', null);
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'viewer' });
    world.addGrant(agent, scopeAgent, removed, 'explicit');
    const decision = await canUserAccessAgent({ userKey: removed.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(decision).toEqual({ allowed: false, reason: 'SCOPE_ACCESS_DENIED' });
  });

  test('a suspended membership loses access immediately even with grants intact', async () => {
    const world = new AgentAccessWorld();
    const member = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, member, 'inherited');
    world.setOrgRole(member, 'member', 'suspended');
    const decision = await canUserAccessAgent({ userKey: member.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(decision).toEqual({ allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED' });
  });

  test('an agent in another scope or organization is not reachable', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const { agent } = world.addAgent();
    const foreignScope = await canUserAccessAgent({ userKey: owner.user.key, organizationKey: world.organization.key, scopeKey: newId(), agentKey: agent.key }, world.access);
    expect(foreignScope).toEqual({ allowed: false, reason: 'SCOPE_ACCESS_DENIED' });
    const foreignOrganization = await canUserAccessAgent({ userKey: owner.user.key, organizationKey: newId(), scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(foreignOrganization).toEqual({ allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED' });
    const unlinkedAgent = await canUserAccessAgent({ userKey: owner.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: newId() }, world.access);
    expect(unlinkedAgent).toEqual({ allowed: false, reason: 'AGENT_NOT_IN_SCOPE' });
  });

  test('inherited grants stop counting below the threshold while explicit grants survive demotion', async () => {
    const world = new AgentAccessWorld();
    const member = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, member, 'inherited');
    world.setScopeRole(member, 'viewer');
    const demoted = await canUserAccessAgent({ userKey: member.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(demoted).toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });

    world.addGrant(agent, scopeAgent, member, 'explicit');
    const withExplicit = await canUserAccessAgent({ userKey: member.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access);
    expect(withExplicit).toMatchObject({ allowed: true, grantSources: ['explicit'] });
  });

  test('unauthenticated and unknown users are rejected first', async () => {
    const world = new AgentAccessWorld();
    const { agent } = world.addAgent();
    expect(await canUserAccessAgent({ userKey: '', organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access)).toEqual({ allowed: false, reason: 'UNAUTHENTICATED' });
    expect(await canUserAccessAgent({ userKey: newId(), organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: agent.key }, world.access)).toEqual({ allowed: false, reason: 'UNAUTHENTICATED' });
  });
});

describe('system-agent security policies', () => {
  test('Genesis requires the root organization, owner role, and an explicit grant', async () => {
    const nonRoot = new AgentAccessWorld({ isRoot: false });
    const nonRootOwner = nonRoot.addMember('owner');
    const nonRootGenesis = nonRoot.addAgent({ slug: 'genesis', minimumAccessRole: 'owner' });
    nonRoot.addGrant(nonRootGenesis.agent, nonRootGenesis.scopeAgent, nonRootOwner, 'explicit');
    expect(await canUserAccessAgent({ userKey: nonRootOwner.user.key, organizationKey: nonRoot.organization.key, scopeKey: nonRoot.scope.key, agentKey: nonRootGenesis.agent.key }, nonRoot.access))
      .toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });

    const root = new AgentAccessWorld({ isRoot: true });
    const rootOwner = root.addMember('owner');
    const rootViewer = root.addMember('member', 'viewer');
    const genesis = root.addAgent({ slug: 'genesis', minimumAccessRole: 'owner' });

    // Root owner without an explicit grant is denied — inherited grants do not satisfy Genesis.
    root.addGrant(genesis.agent, genesis.scopeAgent, rootOwner, 'inherited');
    expect(await canUserAccessAgent({ userKey: rootOwner.user.key, organizationKey: root.organization.key, scopeKey: root.scope.key, agentKey: genesis.agent.key }, root.access))
      .toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });

    root.addGrant(genesis.agent, genesis.scopeAgent, rootOwner, 'explicit');
    expect(await canUserAccessAgent({ userKey: rootOwner.user.key, organizationKey: root.organization.key, scopeKey: root.scope.key, agentKey: genesis.agent.key }, root.access))
      .toMatchObject({ allowed: true, grantSources: ['explicit'] });

    // A root viewer is denied even with an explicit grant: the owner floor applies.
    root.addGrant(genesis.agent, genesis.scopeAgent, rootViewer, 'explicit');
    expect(await canUserAccessAgent({ userKey: rootViewer.user.key, organizationKey: root.organization.key, scopeKey: root.scope.key, agentKey: genesis.agent.key }, root.access))
      .toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });
  });

  test('Steward requires admin authority and an explicit grant in any organization', async () => {
    const world = new AgentAccessWorld();
    const admin = world.addMember('admin');
    const moderator = world.addMember('member', 'moderator');
    const steward = world.addAgent({ slug: 'steward', minimumAccessRole: 'admin' });
    world.addGrant(steward.agent, steward.scopeAgent, admin, 'explicit');
    world.addGrant(steward.agent, steward.scopeAgent, moderator, 'explicit');
    expect(await canUserAccessAgent({ userKey: admin.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: steward.agent.key }, world.access))
      .toMatchObject({ allowed: true, grantSources: ['explicit'] });
    expect(await canUserAccessAgent({ userKey: moderator.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: steward.agent.key }, world.access))
      .toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });
  });

  test('delegation into Genesis is denied even for members holding explicit grants', async () => {
    const root = new AgentAccessWorld({ isRoot: true });
    const rootOwner = root.addMember('owner');
    const genesis = root.addAgent({ slug: 'genesis', minimumAccessRole: 'owner' });
    root.addGrant(genesis.agent, genesis.scopeAgent, rootOwner, 'explicit');
    const delegated = await canUserAccessAgent({ userKey: rootOwner.user.key, organizationKey: root.organization.key, scopeKey: root.scope.key, agentKey: genesis.agent.key, delegated: true }, root.access);
    expect(delegated).toEqual({ allowed: false, reason: 'AGENT_ACCESS_DENIED' });
  });

  test('Beacon stays broadly available to any member with scope access and a grant', async () => {
    const world = new AgentAccessWorld({ isRoot: true });
    const viewer = world.addMember('member', 'viewer');
    const beacon = world.addAgent({ slug: 'beacon', minimumAccessRole: 'viewer' });
    world.addGrant(beacon.agent, beacon.scopeAgent, viewer, 'inherited');
    expect(await canUserAccessAgent({ userKey: viewer.user.key, organizationKey: world.organization.key, scopeKey: world.scope.key, agentKey: beacon.agent.key }, world.access))
      .toMatchObject({ allowed: true, grantSources: ['inherited'] });
  });
});

describe('permission functions', () => {
  test('creation permission follows the central policy: moderator and above', () => {
    expect(canCreateAgent({ effectiveRole: 'owner' })).toBe(true);
    expect(canCreateAgent({ effectiveRole: 'admin' })).toBe(true);
    expect(canCreateAgent({ effectiveRole: 'moderator' })).toBe(true);
    expect(canCreateAgent({ effectiveRole: 'viewer' })).toBe(false);
    expect(canCreateAgent({ effectiveRole: null })).toBe(false);
  });

  test('member management is owner/admin only; threshold updates are owner only', () => {
    expect(canManageAgentMembers({ effectiveRole: 'owner' })).toBe(true);
    expect(canManageAgentMembers({ effectiveRole: 'admin' })).toBe(true);
    expect(canManageAgentMembers({ effectiveRole: 'moderator' })).toBe(false);
    expect(canUpdateAccessThreshold({ effectiveRole: 'owner' })).toBe(true);
    expect(canUpdateAccessThreshold({ effectiveRole: 'admin' })).toBe(false);
  });
});
