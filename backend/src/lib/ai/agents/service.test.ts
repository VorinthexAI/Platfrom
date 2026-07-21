import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSchema, type Agent } from '@/lib/db/agents.node';
import { agentSkillSchema, type AgentSkill } from '@/lib/db/agent-skills.node';
import { skillSchema, type Skill } from '@/lib/db/skills.node';
import { scopeSchema } from '@/lib/ai/scopes';
import {
  AgentReferenceNotFoundError,
  DuplicateAgentLinkError,
  DuplicateAgentSlugError,
  createAgentService,
  type AgentServiceDataSource,
} from './service';

function fixture() {
  const scope = scopeSchema.parse({
    key: newId(), organizationKey: newId(), slug: 'core', name: 'Core', summary: 'Core scope.', description: 'Core scope.', position: 2,
  });
  const skill = skillSchema.parse({
    key: newId(), slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: '# Backend Developer',
  });
  const agents = new Map<string, Agent>();
  const skills = new Map([[skill.key, skill]] satisfies [string, Skill][]);
  const agentSkills = new Map<string, AgentSkill>();

  const source: AgentServiceDataSource = {
    async findAgentByKey(key) { return agents.get(key) ?? null; },
    async findAgentBySlug(slug) { return [...agents.values()].find((agent) => agent.slug === slug) ?? null; },
    async findScopeByKey(key) { return key === scope.key ? scope : null; },
    async findSkillByKey(key) { return skills.get(key) ?? null; },
    async findAgentSkill(agentKey, skillKey) { return agentSkills.get(`${agentKey}:${skillKey}`) ?? null; },
    async saveAgent(input) {
      const agent = agentSchema.parse({ ...input, key: newId() });
      agents.set(agent.key, agent);
      return agent;
    },
    async saveAgentSkill(input) {
      const link = agentSkillSchema.parse({ ...input, key: newId() });
      agentSkills.set(`${link.agentKey}:${link.skillKey}`, link);
      return link;
    },
  };
  return { scope, skill, source };
}

describe('agent service integrity', () => {
  test('requires an existing scope and unique global agent slug', async () => {
    const { scope, source } = fixture();
    const service = createAgentService(source);
    await expect(service.createAgent({ slug: 'lost', name: 'Lost', title: 'Agent', scopeKey: newId() }))
      .rejects.toBeInstanceOf(AgentReferenceNotFoundError);
    await service.createAgent({ slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: scope.key });
    await expect(service.createAgent({ slug: 'forge', name: 'Other', title: 'Developer', scopeKey: scope.key }))
      .rejects.toBeInstanceOf(DuplicateAgentSlugError);
  });

  test('rejects missing references and duplicate skill links', async () => {
    const { scope, skill, source } = fixture();
    const service = createAgentService(source);
    const agent = await service.createAgent({ slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: scope.key });
    await expect(service.attachSkill({ agentKey: agent.key, skillKey: newId(), priority: 100 }))
      .rejects.toBeInstanceOf(AgentReferenceNotFoundError);
    await service.attachSkill({ agentKey: agent.key, skillKey: skill.key, priority: 100 });
    await expect(service.attachSkill({ agentKey: agent.key, skillKey: skill.key, priority: 90 }))
      .rejects.toBeInstanceOf(DuplicateAgentLinkError);
  });

});
