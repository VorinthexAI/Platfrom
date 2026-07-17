import { describe, expect, test } from 'bun:test';
import { syncAgentMembersForMembership, syncInheritedAgentMembersForScopeAgent } from './sync';
import { AgentAccessWorld } from './test-fixtures';

describe('syncInheritedAgentMembersForScopeAgent', () => {
  test('a new admin joining later receives inherited access to an old moderator-threshold agent', async () => {
    const world = new AgentAccessWorld();
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator', createdBy: moderator });
    world.addGrant(agent, scopeAgent, moderator, 'inherited');

    const newAdmin = world.addMember('admin');
    const result = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(result).toMatchObject({ createdCount: 1, removedCount: 0 });
    expect(world.grants.some((grant) => grant.userOrganizationKey === newAdmin.membership.key && grant.source === 'inherited')).toBe(true);
  });

  test('promotion adds and demotion removes inherited grants; explicit grants are never touched', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const bob = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, owner, 'inherited');
    world.addGrant(agent, scopeAgent, bob, 'inherited');
    const explicitGrant = world.addGrant(agent, scopeAgent, bob, 'explicit', owner);

    world.setScopeRole(bob, 'viewer');
    const demotion = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(demotion).toMatchObject({ createdCount: 0, removedCount: 1 });
    expect(world.grants.filter((grant) => grant.userOrganizationKey === bob.membership.key).map((grant) => grant.source)).toEqual(['explicit']);
    expect(world.grants).toContain(explicitGrant);

    world.setScopeRole(bob, 'moderator');
    const promotion = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(promotion).toMatchObject({ createdCount: 1, removedCount: 0 });
  });

  test('repeated synchronization is idempotent and creates no duplicates', async () => {
    const world = new AgentAccessWorld();
    world.addMember('owner');
    world.addMember('admin');
    const { scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    const afterFirst = world.grants.length;
    const second = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(second).toMatchObject({ createdCount: 0, removedCount: 0 });
    expect(world.grants.length).toBe(afterFirst);
  });

  test('threshold lowering creates grants; raising removes only stale inherited grants', async () => {
    const world = new AgentAccessWorld();
    const admin = world.addMember('admin');
    const moderator = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'admin' });
    world.addGrant(agent, scopeAgent, admin, 'inherited');
    const keptExplicit = world.addGrant(agent, scopeAgent, moderator, 'explicit', admin);

    const lowered = await world.management.updateScopeAgentThreshold(scopeAgent.key, 'moderator');
    const lowering = await syncInheritedAgentMembersForScopeAgent(lowered.key, world.sync);
    expect(lowering).toMatchObject({ createdCount: 1, removedCount: 0 });

    await world.management.updateScopeAgentThreshold(scopeAgent.key, 'owner');
    const raising = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(raising.removedCount).toBe(2);
    expect(world.grants).toContain(keptExplicit);
  });

  test('explicit-grant-only agents (Genesis) converge to zero inherited grants', async () => {
    const world = new AgentAccessWorld({ isRoot: true });
    const owner = world.addMember('owner');
    const genesis = world.addAgent({ slug: 'genesis', minimumAccessRole: 'owner' });
    world.addGrant(genesis.agent, genesis.scopeAgent, owner, 'inherited');
    const explicitGrant = world.addGrant(genesis.agent, genesis.scopeAgent, owner, 'explicit');
    const result = await syncInheritedAgentMembersForScopeAgent(genesis.scopeAgent.key, world.sync);
    expect(result).toMatchObject({ eligibleCount: 0, createdCount: 0, removedCount: 1 });
    expect(world.grants).toEqual([explicitGrant]);
  });

  test('emits a minimal synchronization event only when something changed', async () => {
    const world = new AgentAccessWorld();
    world.addMember('owner');
    const { scopeAgent } = world.addAgent({ minimumAccessRole: 'owner' });
    await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(world.events).toEqual([
      expect.objectContaining({ slug: 'agent.access.synchronized', data: expect.objectContaining({ createdCount: 1, removedCount: 0 }) }),
    ]);
    await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, world.sync);
    expect(world.events).toHaveLength(1);
  });
});

describe('syncAgentMembersForMembership', () => {
  test('a removed or suspended membership loses every grant outright', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const member = world.addMember('member', 'moderator');
    const { agent, scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    world.addGrant(agent, scopeAgent, member, 'inherited');
    world.addGrant(agent, scopeAgent, member, 'explicit', owner);
    world.setOrgRole(member, 'member', 'suspended');
    const result = await syncAgentMembersForMembership(member.membership.key, world.sync);
    expect(result.removedAllGrants).toBe(true);
    expect(world.grants.filter((grant) => grant.userOrganizationKey === member.membership.key)).toHaveLength(0);
  });

  test('an active membership re-synchronizes every scope agent it can reach', async () => {
    const world = new AgentAccessWorld();
    const member = world.addMember('member', 'moderator');
    const { scopeAgent } = world.addAgent({ minimumAccessRole: 'moderator' });
    const { results } = await syncAgentMembersForMembership(member.membership.key, world.sync);
    expect(results).toEqual([expect.objectContaining({ scopeAgentKey: scopeAgent.key, createdCount: 1 })]);
  });
});
