import { describe, expect, test } from 'bun:test';
import {
  AgentCreationConflictError,
  AgentCreationDeniedError,
  createAgentAsMember,
  type AgentCreationTransactionGateway,
  type CreateAgentAsMemberOptions,
} from './creation';
import { AgentAccessWorld, type WorldMember } from './test-fixtures';

interface StagedWrite { collection: string; document: Record<string, unknown> }

function creationHarness(world: AgentAccessWorld, options: { failOnCollection?: string } = {}) {
  const committed: StagedWrite[] = [];
  const transaction: AgentCreationTransactionGateway = {
    async execute(callback) {
      const staged: StagedWrite[] = [];
      const result = await callback({
        async save(collection, document) {
          if (collection === options.failOnCollection) throw new Error(`simulated ${collection} write failure`);
          staged.push({ collection, document });
        },
      });
      committed.push(...staged);
      return result;
    },
  };
  const creationOptions: CreateAgentAsMemberOptions = {
    getUser: world.access.getUser,
    getOrganization: world.access.getOrganization,
    getMembership: world.access.getMembership,
    getScope: world.access.getScope,
    getScopeMember: world.access.getScopeMember,
    findAgentBySlug: async (slug) => world.agents.find((agent) => agent.slug === slug) ?? null,
    sync: world.sync,
    transaction,
    emitEvent: world.emitEvent,
  };
  return { committed, creationOptions };
}

function createInput(world: AgentAccessWorld, creator: WorldMember, slug = 'new-agent') {
  return {
    userKey: creator.user.key,
    organizationKey: world.organization.key,
    scopeKey: world.scope.key,
    manifest: { slug, name: 'New Agent', title: 'New Agent' },
  };
}

function grantedMembershipKeys(committed: StagedWrite[]): string[] {
  return committed
    .filter((write) => write.collection === 'agentMembers')
    .map((write) => String(write.document.userOrganizationKey))
    .sort();
}

describe('createAgentAsMember', () => {
  test('an owner-created agent grants owners only', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const secondOwner = world.addMember('owner');
    world.addMember('admin');
    world.addMember('member', 'moderator');
    world.addMember('member', 'viewer');
    const { committed, creationOptions } = creationHarness(world);
    const result = await createAgentAsMember(createInput(world, owner), creationOptions);
    expect(result.scopeAgent.minimumAccessRole).toBe('owner');
    expect(result.scopeAgent.createdByUserOrganizationKey).toBe(owner.membership.key);
    expect(grantedMembershipKeys(committed)).toEqual([owner.membership.key, secondOwner.membership.key].sort());
    expect(result.grants.every((grant) => grant.source === 'inherited')).toBe(true);
  });

  test('an admin-created agent grants owners and admins, never moderators or viewers', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const admin = world.addMember('admin');
    world.addMember('member', 'moderator');
    world.addMember('member', 'viewer');
    const { committed, creationOptions } = creationHarness(world);
    const result = await createAgentAsMember(createInput(world, admin), creationOptions);
    expect(result.scopeAgent.minimumAccessRole).toBe('admin');
    expect(grantedMembershipKeys(committed)).toEqual([owner.membership.key, admin.membership.key].sort());
  });

  test('a moderator-created agent grants owners, admins, and moderators', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const admin = world.addMember('admin');
    const moderator = world.addMember('member', 'moderator');
    world.addMember('member', 'viewer');
    const { committed, creationOptions } = creationHarness(world);
    const result = await createAgentAsMember(createInput(world, moderator), creationOptions);
    expect(result.scopeAgent.minimumAccessRole).toBe('moderator');
    expect(grantedMembershipKeys(committed)).toEqual([owner.membership.key, admin.membership.key, moderator.membership.key].sort());
    expect(result.grants.some((grant) => grant.userOrganizationKey === moderator.membership.key)).toBe(true);
  });

  test('viewers may not create agents by default', async () => {
    const world = new AgentAccessWorld();
    const viewer = world.addMember('member', 'viewer');
    const { creationOptions } = creationHarness(world);
    await expect(createAgentAsMember(createInput(world, viewer), creationOptions)).rejects.toMatchObject({ reason: 'AGENT_CREATE_DENIED' });
  });

  test('organization membership without scope access cannot create', async () => {
    const world = new AgentAccessWorld();
    const orgOnly = world.addMember('member', null);
    const { creationOptions } = creationHarness(world);
    await expect(createAgentAsMember(createInput(world, orgOnly), creationOptions)).rejects.toMatchObject({ reason: 'SCOPE_ACCESS_DENIED' });
  });

  test('the client cannot choose the threshold — unknown manifest fields are rejected', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const { committed, creationOptions } = creationHarness(world);
    const input = { ...createInput(world, owner), manifest: { slug: 'sneaky', name: 'Sneaky', title: 'Sneaky', minimumAccessRole: 'viewer' } };
    await expect(createAgentAsMember(input as never, creationOptions)).rejects.toThrow();
    expect(committed).toHaveLength(0);
  });

  test('a failed grant write aborts the whole creation — no partially authorized agent survives', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    const { committed, creationOptions } = creationHarness(world, { failOnCollection: 'agentMembers' });
    await expect(createAgentAsMember(createInput(world, owner), creationOptions)).rejects.toThrow('simulated agentMembers write failure');
    expect(committed).toHaveLength(0);
  });

  test('duplicate agent slugs are rejected before any write', async () => {
    const world = new AgentAccessWorld();
    const owner = world.addMember('owner');
    world.addAgent({ slug: 'taken' });
    const { committed, creationOptions } = creationHarness(world);
    await expect(createAgentAsMember(createInput(world, owner, 'taken'), creationOptions)).rejects.toBeInstanceOf(AgentCreationConflictError);
    expect(committed).toHaveLength(0);
  });

  test('unknown users and suspended memberships are denied', async () => {
    const world = new AgentAccessWorld();
    const suspended = world.addMember('owner', null, 'suspended');
    const { creationOptions } = creationHarness(world);
    await expect(createAgentAsMember(createInput(world, suspended), creationOptions)).rejects.toBeInstanceOf(AgentCreationDeniedError);
  });
});
