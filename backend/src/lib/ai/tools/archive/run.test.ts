import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema } from '@/lib/db/agent-members.node';
import type { RuntimeEventInput } from '@/platform/events';
import { runArchiveAgentTool } from './run';

const now = '2026-07-22T00:00:00.000Z';
function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'archive', name: 'Archive', summary: 'Archive', description: 'Archive', position: 1 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: membership.key, role: 'owner' });
  const agent = agentSchema.parse({ key: newId(), slug: 'archive-agent', name: 'Archive Agent', title: 'Archivist', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'archive', name: 'Archive', title: 'Archive', definition: 'Use Archive tools.' });
  const relation = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, position: 1, minimumAccessRole: 'owner', createdAt: now, updatedAt: now });
  const grant = agentMemberSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey: membership.key, source: 'inherited', createdAt: now });
  const runtimeData = { async getAgent() { return agent; }, async getScope() { return scope; }, async getOrganization() { return organization; }, async listAgentSkills() { return [relation]; }, async getSkill() { return skill; } };
  const accessData = { async getUserOrganization() { return membership; }, async getUser() { return user; }, async listScopeMembers() { return [scopeMember]; }, async getScopeAgent() { return scopeAgent; }, async listAgentMembers() { return [grant]; } };
  return { organization, scope, user, membership, agent, runtimeData, accessData };
}

describe('runArchiveAgentTool', () => {
  test('derives the principal from the authenticated user and dispatches with safe events', async () => {
    const f = fixture(); const events: RuntimeEventInput[] = []; let received: any;
    const output = await runArchiveAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, tool: 'folder.list', input: { scopeKey: f.scope.key } }, {
      authenticatedUserKey: f.user.key, runtimeData: f.runtimeData, accessData: f.accessData,
      resolveMembership: async (organizationKey, userKey) => organizationKey === f.organization.key && userKey === f.user.key ? f.membership : null,
      events: async (event) => { events.push(event); },
      execute: (async (tool: any, input: any, context: any) => { received = { tool, input, context }; return { folders: [] }; }) as any,
    });
    expect(output).toEqual({ folders: [] });
    expect(received).toMatchObject({ tool: 'folder.list', context: { principal: { kind: 'member', user: { key: f.user.key }, userOrganization: { key: f.membership.key } } } });
    expect(events.map((event) => event.slug)).toEqual(['agent.started', 'agent.completed']);
    expect(events[0]!.data).toEqual({ invocationKey: events[0]!.data.invocationKey, agentKey: f.agent.key, actionSlug: 'folder.list', status: 'started' });
    expect(JSON.stringify(events)).not.toContain('scopeKey');
  });

  test('rejects organization-agent mismatch before membership resolution', async () => {
    const f = fixture(); let resolved = false;
    await expect(runArchiveAgentTool({ organizationKey: newId(), agentKey: f.agent.key, tool: 'folder.list', input: {} }, {
      authenticatedUserKey: f.user.key, runtimeData: f.runtimeData, accessData: f.accessData,
      resolveMembership: async () => { resolved = true; return f.membership; }, events: async () => {},
    })).rejects.toMatchObject({ code: 'ARCHIVE_FORBIDDEN' });
    expect(resolved).toBe(false);
  });

  test('emits a safe failed event without tool input or error content', async () => {
    const f = fixture(); const events: RuntimeEventInput[] = [];
    await expect(runArchiveAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, tool: 'folder.list', input: { secret: 'do-not-log' } }, {
      authenticatedUserKey: f.user.key, runtimeData: f.runtimeData, accessData: f.accessData,
      resolveMembership: async () => f.membership, events: async (event) => { events.push(event); },
      execute: (async () => { throw new Error('sensitive provider response'); }) as any,
    })).rejects.toThrow('sensitive provider response');
    expect(events.map((event) => event.slug)).toEqual(['agent.started', 'agent.failed']);
    expect(JSON.stringify(events)).not.toContain('do-not-log');
    expect(JSON.stringify(events)).not.toContain('sensitive provider response');
  });

  test('cannot use a membership belonging to another authenticated user', async () => {
    const f = fixture();
    await expect(runArchiveAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, tool: 'folder.list', input: {} }, {
      authenticatedUserKey: newId(), runtimeData: f.runtimeData, accessData: f.accessData,
      resolveMembership: async () => f.membership, events: async () => {},
    })).rejects.toMatchObject({ code: 'ARCHIVE_FORBIDDEN' });
  });

  test('strictly rejects unknown tools and top-level fields', async () => {
    const f = fixture(); const options = { authenticatedUserKey: f.user.key, runtimeData: f.runtimeData, accessData: f.accessData, resolveMembership: async () => f.membership, events: async () => {} };
    await expect(runArchiveAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, tool: 'unknown', input: {} } as any, options)).rejects.toThrow();
    await expect(runArchiveAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, tool: 'folder.list', input: {}, principal: { kind: 'system' } } as any, options)).rejects.toThrow();
  });
});
