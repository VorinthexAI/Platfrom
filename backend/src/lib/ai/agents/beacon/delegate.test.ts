import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { toolSchema } from '@/lib/db/tools.node';
import { actionSchema } from '@/lib/db/actions.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import { agentRunSchema, type AgentRun, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { agentRunStepSchema, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import type { GenesisCreationResult } from '@/lib/ai/agents/genesis';
import type { RuntimeEventInput } from '@/platform/events';
import { BeaconDelegationError, delegateAgentCreationFromBeacon } from './delegate';

const now = '2026-07-18T00:00:00.000Z';

function fixture(role: 'owner' | 'admin' = 'owner') {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'launch', name: 'Launch', summary: 'Launch', description: 'Launch', position: 1 });
  const otherScope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: role, status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const beaconHome = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'nexus', name: 'Nexus', summary: 'Nexus', description: 'Nexus', position: 1 });
  const beacon = agentSchema.parse({ key: newId(), slug: 'beacon', name: 'Beacon', title: 'AI Coordinator', scopeKey: beaconHome.key });
  const genesis = agentSchema.parse({ key: newId(), slug: 'genesis', name: 'Genesis', title: 'Agent Architect', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'beacon-coordination', name: 'Beacon', title: 'AI Coordinator', definition: 'Coordinate safe delegation.' });
  const tool = toolSchema.parse({ key: newId(), slug: 'core.delegate', name: 'Delegate', description: 'Delegate safely.' });
  const action = actionSchema.parse({ key: newId(), slug: 'core.delegate', name: 'Delegate', description: 'Delegate safely.', objective: 'Delegate', inputDescription: 'Task', outputDescription: 'Result', handlerKey: 'core.delegate' });
  const agentSkill = agentSkillSchema.parse({ key: newId(), agentKey: beacon.key, skillKey: skill.key, priority: 100 });
  const agentTool = agentToolSchema.parse({ key: newId(), agentKey: beacon.key, toolKey: tool.key });
  const toolAction = toolActionSchema.parse({ key: newId(), toolKey: tool.key, actionKey: action.key, priority: 100 });
  const runtimeData = {
    async getAgent(key: string) { return key === beacon.key ? beacon : key === genesis.key ? genesis : null; }, async getScope(key: string) { return key === beaconHome.key ? beaconHome : key === scope.key ? scope : null; }, async getOrganization(key: string) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkill]; }, async getSkill() { return skill; }, async listAgentTools() { return [agentTool]; }, async getTool() { return tool; }, async listToolActions() { return [toolAction]; }, async getAction() { return action; },
  };
  const runStore: AgentRun[] = []; const stepStore: AgentRunStep[] = []; const events: RuntimeEventInput[] = [];
  const runs: AgentRunRepository = { async insertRun(input) { const value = agentRunSchema.parse({ ...input, key: newId(), createdAt: now }); runStore.push(value); return value; }, async updateRun(key, input) { const index = runStore.findIndex((run) => run.key === key); const value = agentRunSchema.parse({ ...runStore[index]!, ...input }); runStore[index] = value; return value; }, async getRunById(key) { return runStore.find((run) => run.key === key) ?? null; }, async listRunsForOrganization() { return runStore; } };
  const steps: AgentRunStepRepository = { async insertStep(input) { const value = agentRunStepSchema.parse({ ...input, key: input.key ?? newId() }); stepStore.push(value); return value; }, async listStepsForRun(key) { return stepStore.filter((step) => step.agentRunKey === key); } };
  return { organization, scope, otherScope, user, membership, beacon, genesis, runtimeData, runs, steps, runStore, stepStore, events };
}

describe('Beacon core.delegate', () => {
  test('delegates only to server-resolved Genesis and preserves the human principal', async () => {
    const f = fixture(); let received: { input: unknown; options: unknown } | null = null;
    const result = await delegateAgentCreationFromBeacon({ organization: f.organization, scope: f.scope, membership: f.membership, user: f.user, input: { request: 'Create a generic organization administration agent.' } }, {
      runtimeData: f.runtimeData, runs: f.runs, steps: f.steps, events: async (event) => { f.events.push(event); },
      resolveAgent: async (slug) => slug === 'beacon' ? f.beacon : slug === 'genesis' ? f.genesis : null,
      createFromGenesis: async (input, options) => {
        received = { input, options };
        return { runKey: newId(), persisted: true, toolOutput: { status: 'created', agentKey: newId(), createdSkillKeys: [], reusedSkillKeys: [], agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: 'Created validated architecture' } } as unknown as GenesisCreationResult;
      },
    });
    expect(received).toMatchObject({ input: { organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key }, options: { principal: { kind: 'member', userOrganizationKey: f.membership.key }, executionContext: { organization: { key: f.organization.key }, scope: { key: f.scope.key } }, serviceDelegation: { agentSlug: 'genesis', requiredOrganizationRole: 'owner' } } });
    expect(result.creation.toolOutput.status).toBe('created');
    expect(f.runStore[0]).toMatchObject({ agentKey: f.beacon.key, userOrganizationKey: f.membership.key, status: 'completed' });
    expect(f.stepStore[0]).toMatchObject({ stepSlug: 'delegate-to-genesis', status: 'completed' });
    expect(f.events.map(({ slug }) => slug)).toEqual(['agent.started', 'step.started', 'tool.called', 'tool.completed', 'step.completed', 'agent.completed']);
  });

  test('denies admins before resolving or invoking Genesis', async () => {
    const f = fixture('admin'); let resolved = false;
    await expect(delegateAgentCreationFromBeacon({ organization: f.organization, scope: f.scope, membership: f.membership, user: f.user, input: { request: 'Create an agent.' } }, { resolveAgent: async () => { resolved = true; return null; } })).rejects.toBeInstanceOf(BeaconDelegationError);
    expect(resolved).toBe(false);
  });

  test('denies Genesis delegation outside Launch', async () => {
    const f = fixture(); let invoked = false;
    await expect(delegateAgentCreationFromBeacon({ organization: f.organization, scope: f.otherScope, membership: f.membership, user: f.user, input: { request: 'Create an agent.' } }, {
      runtimeData: f.runtimeData, runs: f.runs, steps: f.steps,
      resolveAgent: async (slug) => slug === 'beacon' ? f.beacon : slug === 'genesis' ? f.genesis : null,
      createFromGenesis: async () => { invoked = true; throw new Error('should not be called'); },
    })).rejects.toBeInstanceOf(BeaconDelegationError);
    expect(invoked).toBe(false);
  });
});
