import { describe, expect, test } from 'bun:test';
import {
  AgentManagementDeniedError,
  grantExplicitAgentAccess,
  listAgentMemberAccess,
  revokeExplicitAgentAccess,
  updateAgentAccessThreshold,
} from './management';
import { AgentAccessWorld, type WorldMember } from './test-fixtures';

function managementRequest(world: AgentAccessWorld, actor: WorldMember, agentKey: string) {
  return {
    actorUserKey: actor.user.key,
    organizationKey: world.organization.key,
    scopeKey: world.scope.key,
    agentKey,
  };
}

describe('grantExplicitAgentAccess', () => {
  test('an owner grants a moderator explicit access below the threshold', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');

    const result = await grantExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: moderator.membership.key }, world.management);
    expect(result.alreadyGranted).toBe(false);
    expect(result.grant).toMatchObject({ source: 'explicit', userOrganizationKey: moderator.membership.key, createdByUserOrganizationKey: owner.membership.key });
    expect(world.events).toContainEqual(expect.objectContaining({ slug: 'agent.member.granted' }));

    const repeat = await grantExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: moderator.membership.key }, world.management);
    expect(repeat.alreadyGranted).toBe(true);
    expect(world.grants.filter((grant) => grant.source === 'explicit')).toHaveLength(1);
  });

  test('a moderator may not manage explicit access', async () => {
    const world = new AgentAccessWorld();
    const moderator = world.addMember('member', 'moderator');
    const viewer = world.addMember('member', 'viewer');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, moderator, 'inherited');
    await expect(grantExplicitAgentAccess({ ...managementRequest(world, moderator, agent.key), targetUserOrganizationKey: viewer.membership.key }, world.management))
      .rejects.toThrow(AgentManagementDeniedError);
  });

  test('an admin without effective agent access may not grant it to others', async () => {
    const world = new AgentAccessWorld();
    const admin = world.addMember('admin');
    const viewer = world.addMember('member', 'viewer');
    const { agent } = world.addAgent({ minimumAccessRole: 'owner' });
    await expect(grantExplicitAgentAccess({ ...managementRequest(world, admin, agent.key), targetUserOrganizationKey: viewer.membership.key }, world.management))
      .rejects.toThrow('has no effective access');
  });

  test('explicit grants never create scope access: a target without scope access is rejected', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const orgOnly = world.addMember('member', null);
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'owner' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    await expect(grantExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: orgOnly.membership.key }, world.management))
      .rejects.toThrow('explicit agent access cannot create it');
  });

  test('memberships from another organization are rejected', async () => {
    const world = new AgentAccessWorld();
    const other = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const outsider = other.addMember('owner');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'owner' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    await expect(grantExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: outsider.membership.key }, world.management))
      .rejects.toThrow('not an active member');
  });
});

describe('revokeExplicitAgentAccess', () => {
  test('removes only the explicit grant and reports remaining inherited access honestly', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const admin = world.addMember('admin');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    world.addGrant(agent, scopeAgent, admin, 'inherited');
    world.addGrant(agent, scopeAgent, admin, 'explicit', owner);

    const result = await revokeExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: admin.membership.key }, world.management);
    expect(result).toEqual({ explicitGrantRemoved: true, effectiveAccessRemaining: true, remainingSources: ['inherited'] });
    expect(world.grants.filter((grant) => grant.userOrganizationKey === admin.membership.key)).toHaveLength(1);
  });

  test('reports full revocation when no inherited grant remains valid', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    world.addGrant(agent, scopeAgent, moderator, 'explicit', owner);
    const result = await revokeExplicitAgentAccess({ ...managementRequest(world, owner, agent.key), targetUserOrganizationKey: moderator.membership.key }, world.management);
    expect(result).toEqual({ explicitGrantRemoved: true, effectiveAccessRemaining: false, remainingSources: [] });
  });
});

describe('updateAgentAccessThreshold', () => {
  test('only owners may change the threshold, and the change synchronizes grants', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const admin = world.addMember('admin');
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    world.addGrant(agent, scopeAgent, admin, 'inherited');

    await expect(updateAgentAccessThreshold({ ...managementRequest(world, admin, agent.key), minimumAccessRole: 'moderator' }, world.management))
      .rejects.toThrow('may not update the access threshold');

    const lowered = await updateAgentAccessThreshold({ ...managementRequest(world, owner, agent.key), minimumAccessRole: 'moderator' }, world.management);
    expect(lowered).toMatchObject({ createdCount: 1, removedCount: 0 });
    expect(world.grants.some((grant) => grant.userOrganizationKey === moderator.membership.key && grant.source === 'inherited')).toBe(true);
    expect(world.events).toContainEqual(expect.objectContaining({ slug: 'agent.access-threshold.updated' }));

    const raised = await updateAgentAccessThreshold({ ...managementRequest(world, owner, agent.key), minimumAccessRole: 'owner' }, world.management);
    expect(raised.removedCount).toBe(2);
  });
});

describe('listAgentMemberAccess', () => {
  test('renders the inherited/explicit/effective table without inventing agent roles', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const admin = world.addMember('admin');
    const moderator = world.addMember('member', 'moderator');
    const viewer = world.addMember('member', 'viewer');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    world.addGrant(agent, scopeAgent, admin, 'inherited');
    world.addGrant(agent, scopeAgent, moderator, 'explicit', owner);

    const table = await listAgentMemberAccess(managementRequest(world, owner, agent.key), world.management);
    expect(table.minimumAccessRole).toBe('admin');
    const byMembership = new Map(table.members.map((member) => [member.userOrganizationKey, member]));
    expect(byMembership.get(owner.membership.key)).toMatchObject({ inherited: true, explicit: false, effective: true, effectiveRole: 'owner' });
    expect(byMembership.get(admin.membership.key)).toMatchObject({ inherited: true, explicit: false, effective: true, effectiveRole: 'admin' });
    expect(byMembership.get(moderator.membership.key)).toMatchObject({ inherited: false, explicit: true, effective: true, effectiveRole: 'moderator' });
    expect(byMembership.get(viewer.membership.key)).toMatchObject({ inherited: false, explicit: false, effective: false, effectiveRole: 'viewer' });
  });
});
