import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { userOrganizationSchema, type UserOrganization } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, type ScopeMember, type ScopeMemberRole } from '@/lib/ai/scopes';
import type { AgentAccessSyncDataSource } from '@/lib/ai/agent-access/sync';
import { compileGenesisContext } from './context';
import { GENESIS_STEP_SLUGS, genesisCreationManifestSchema } from './schemas';
import { buildGenesisFixture } from './test-fixtures';
import { CreateAgentToolGuardrailError, createAgentToolInputSchema, createAgentToolOutputSchema, executeCreateAgentTool } from './tool';

const fixtureNow = '2026-07-16T00:00:00.000Z';

function initiatorFixture(f: ReturnType<typeof buildGenesisFixture>, scopeRole: ScopeMemberRole) {
  const membership: UserOrganization = userOrganizationSchema.parse({ key: newId(), organizationId: f.organization.key, userId: newId(), orgRole: 'member', status: 'active', joinedAt: fixtureNow, createdAt: fixtureNow, updatedAt: fixtureNow });
  const scopeMember: ScopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: f.scope.key, userOrganizationKey: membership.key, role: scopeRole });
  const unused = () => { throw new Error('unused in access-plan resolution'); };
  const accessSync: AgentAccessSyncDataSource = {
    getScopeAgent: unused, listScopeAgents: unused, getAgent: unused, getScope: unused,
    getMembership: async (key) => (key === membership.key ? membership : null),
    listStewardMemberships: async () => [],
    listScopeMemberships: async () => [{ scopeMember, membership }],
    listInheritedGrants: unused, ensureInheritedGrant: unused, deleteGrants: unused,
    deleteAllGrantsForMembership: unused, listOrganizationScopes: unused,
    emitEvent: async () => {},
  };
  return { membership, scopeMember, accessSync, getMembership: async (key: string) => (key === membership.key ? membership : null) };
}

function rejectedManifest(f: ReturnType<typeof buildGenesisFixture>) {
  return genesisCreationManifestSchema.parse({
    metadata: { status: 'rejected', reason: 'Required tool is unavailable', score: 0.99 },
    agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: f.scope.key, explorationRate: 0.2 },
    skills: [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }],
    agentSkills: [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }],
    agentTools: [],
    steps: [...GENESIS_STEP_SLUGS],
    validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: false, permissionsValid: true, noveltyValidated: true, readyToPersist: false, missingToolSlugs: ['repository'], warnings: [] },
  });
}

describe('agent.create local action handler', () => {
  test('uses strict input and output contracts', () => {
    const f = buildGenesisFixture();
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    expect(createAgentToolInputSchema.parse(input)).toEqual(input);
    expect(() => createAgentToolInputSchema.parse({ ...input, arbitraryWrite: true })).toThrow();
    expect(() => createAgentToolOutputSchema.parse({ status: 'created', agentKey: newId(), createdSkillKeys: [], reusedSkillKeys: [], agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: 'Created', extra: true })).toThrow();
  });

  test('returns a rejected result without entering a write transaction', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    let writes = 0;
    const result = await executeCreateAgentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) }, context, { transaction: { async execute() { writes += 1; throw new Error('must not write'); } } });
    expect(result.output).toEqual({ status: 'rejected', agentKey: null, createdSkillKeys: [], reusedSkillKeys: [], agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: 'Required tool is unavailable' });
    expect(writes).toBe(0);
  });

  test('rejects organization and scope context mismatches before writes', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    await expect(executeCreateAgentTool({ organizationKey: newId(), scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) }, context)).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
    await expect(executeCreateAgentTool({ organizationKey: f.organization.key, scopeKey: newId(), agentRunKey: newId(), manifest: rejectedManifest(f) }, context)).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
  });

  test('the initiating human is the authorization principal: viewers cannot create through Genesis', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const viewer = initiatorFixture(f, 'viewer');
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    await expect(executeCreateAgentTool(input, context, {
      principal: { kind: 'member', userOrganizationKey: viewer.membership.key },
      getMembership: viewer.getMembership,
      accessSync: viewer.accessSync,
    })).rejects.toThrow('may not create agents');
  });

  test('a moderator initiator passes the access-plan gate and the manifest outcome decides the rest', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const moderator = initiatorFixture(f, 'moderator');
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    const result = await executeCreateAgentTool(input, context, {
      principal: { kind: 'member', userOrganizationKey: moderator.membership.key },
      getMembership: moderator.getMembership,
      accessSync: moderator.accessSync,
    });
    expect(result.output.status).toBe('rejected');
  });

  test('rejects extra Genesis tools and an invalid agent.create mapping', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    await expect(executeCreateAgentTool(input, { ...context, tools: [...context.tools, context.tools[0]!] })).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
    await expect(executeCreateAgentTool(input, { ...context, tools: [{ ...context.tools[0]!, actions: [] }] })).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
  });
});
