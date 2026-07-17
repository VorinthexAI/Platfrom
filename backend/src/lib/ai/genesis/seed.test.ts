import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { skillSchema } from '@/lib/db/skills.node';
import { agentSchema } from '@/lib/db/agents.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolSchema } from '@/lib/db/tools.node';
import { AGENT_ARCHITECT_SKILL_KEY, GENESIS_AGENT_KEY, GENESIS_AGENT_SKILL_KEY, GENESIS_AGENT_TOOL_KEY, GenesisSeedPrerequisiteError, loadGenesisSeedFiles, seedGenesis, type GenesisSeedDataSource } from './seed';

function fixture(routeValid = true, organizationKey = newId()) {
  const now = '2026-07-16T00:00:00.000Z';
  const organization = organizationSchema.parse({ key: organizationKey, name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'agent-builder', name: 'Agent Builder', description: 'Build agents.', position: 2 });
  const create = toolSchema.parse({ key: newId(), slug: 'agent.create', name: 'Create Agent', description: 'Create agent', scopeKey: null, enabled: true });
  const calls: string[] = [];
  const source: GenesisSeedDataSource = {
    async requireOrganization() { calls.push('organization'); return organization; }, async findScope() { calls.push('scope'); return scope; }, async requireCreateTool() { calls.push('tool'); return create; }, async removeOtherCreateToolActions() { calls.push('removeOtherActions'); }, async verifyExecutionChain() { calls.push('route'); return routeValid; },
    async upsertSkill(seed, definition) { calls.push('skill'); return skillSchema.parse({ ...seed, definition }); },
    async upsertAgent(seed, scopeKey) { calls.push('agent'); return agentSchema.parse({ ...seed, scopeKey }); },
    async upsertAgentSkill(seed, agentKey, skillKey) { calls.push('agentSkill'); return agentSkillSchema.parse({ ...seed, agentKey, skillKey }); },
    async upsertAgentTool(seed, agentKey, toolKey) { calls.push(`agentTool:${seed.toolSlug}`); return agentToolSchema.parse({ ...seed, agentKey, toolKey }); },
    async removeOtherAgentTools() { calls.push('removeOtherTools'); },
    async verifyRuntime() { calls.push('runtime'); },
  };
  return { organization, source, calls };
}

describe('Genesis canonical seed', () => {
  test('contains the exact skill and validated fixed CUIDs', async () => {
    const { seed, definition } = await loadGenesisSeedFiles();
    expect(seed.seed.skills).toHaveLength(1); expect(seed.seed.agents).toHaveLength(1); expect(seed.seed.agentSkills).toHaveLength(1); expect(seed.seed.agentTools).toHaveLength(1);
    expect(seed.seed.skills[0]?.key).toBe(AGENT_ARCHITECT_SKILL_KEY);
    expect(seed.seed.agents[0]?.key).toBe(GENESIS_AGENT_KEY);
    expect(seed.seed.agentSkills[0]).toMatchObject({ key: GENESIS_AGENT_SKILL_KEY, priority: 100 });
    expect(seed.seed.agentTools[0]).toMatchObject({ key: GENESIS_AGENT_TOOL_KEY, toolSlug: 'agent.create' });
    expect(definition).toContain('Reuse\n→ Extend\n→ Create');
    expect(definition).toContain('Never invent tools.');
  });
  test('seeds exactly Agent Architect and agent.create in dependency order', async () => {
    const f = fixture(); const result = await seedGenesis(f.organization.key, f.source);
    expect(result.agent).toMatchObject({ slug: 'genesis', name: 'Genesis', title: 'Agent Architect', explorationRate: 0.2 });
    expect(result.skill).toMatchObject({ slug: 'agent-architect', name: 'Agent Architecture', title: 'Agent Architect' });
    expect(f.calls).toEqual(['organization', 'scope', 'tool', 'removeOtherActions', 'route', 'skill', 'agent', 'agentSkill', 'agentTool:agent.create', 'removeOtherTools', 'runtime']);
    expect(f.calls.some((call) => call.includes('ask'))).toBe(false);
  });
  test('accepts the preserved pre-CUID root organization key', async () => {
    const f = fixture(true, 'legacy-root-key');
    expect((await seedGenesis(f.organization.key, f.source)).organizationKey).toBe('legacy-root-key');
  });
  test('refuses to seed without the persisted Mini/OpenAI reason route', async () => {
    const f = fixture(false);
    await expect(seedGenesis(f.organization.key, f.source)).rejects.toBeInstanceOf(GenesisSeedPrerequisiteError);
    expect(f.calls).not.toContain('skill');
  });
});
