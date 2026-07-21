import { z } from 'zod';
import {
  agentSchema,
  getAgentById,
  getAgentBySlug,
  insertAgent,
  type Agent,
} from '@/lib/db/agents.node';
import {
  getAgentSkillByPair,
  insertAgentSkill,
  type AgentSkill,
} from '@/lib/db/agent-skills.node';
import { getSkillById, type Skill } from '@/lib/db/skills.node';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { isArangoUniqueConstraintError } from '@/lib/db/base';

export const createAgentInputSchema = agentSchema
  .omit({ key: true, embedding: true })
  .strict();

export const attachAgentSkillInputSchema = z.object({
  agentKey: z.string().cuid(),
  skillKey: z.string().cuid(),
  priority: z.number().int().nonnegative().default(100),
}).strict();

export type CreateAgentInput = z.input<typeof createAgentInputSchema>;
export type AttachAgentSkillInput = z.input<typeof attachAgentSkillInputSchema>;

export interface AgentServiceDataSource {
  findAgentByKey(key: string): Promise<Agent | null>;
  findAgentBySlug(slug: string): Promise<Agent | null>;
  findScopeByKey(key: string): Promise<Scope | null>;
  findSkillByKey(key: string): Promise<Skill | null>;
  findAgentSkill(agentKey: string, skillKey: string): Promise<AgentSkill | null>;
  saveAgent(input: CreateAgentInput): Promise<Agent>;
  saveAgentSkill(input: AttachAgentSkillInput): Promise<AgentSkill>;
}

export class AgentReferenceNotFoundError extends Error {
  constructor(public readonly reference: 'agent' | 'scope' | 'skill', public readonly key: string) {
    super(`${reference} reference ${key} does not exist`);
    this.name = 'AgentReferenceNotFoundError';
  }
}

export class DuplicateAgentSlugError extends Error {
  constructor(public readonly slug: string) {
    super(`Agent slug ${slug} already exists`);
    this.name = 'DuplicateAgentSlugError';
  }
}

export class DuplicateAgentLinkError extends Error {
  constructor(public readonly relation: 'skill', public readonly agentKey: string, public readonly targetKey: string) {
    super(`Agent ${agentKey} already has ${relation} ${targetKey}`);
    this.name = 'DuplicateAgentLinkError';
  }
}

export function createAgentService(source: AgentServiceDataSource = createDefaultAgentServiceDataSource()) {
  async function requireAgent(key: string) {
    const agent = await source.findAgentByKey(key);
    if (!agent) throw new AgentReferenceNotFoundError('agent', key);
    return agent;
  }

  return {
    async createAgent(input: CreateAgentInput): Promise<Agent> {
      const valid = createAgentInputSchema.parse(input);
      if (!await source.findScopeByKey(valid.scopeKey)) {
        throw new AgentReferenceNotFoundError('scope', valid.scopeKey);
      }
      if (await source.findAgentBySlug(valid.slug)) {
        throw new DuplicateAgentSlugError(valid.slug);
      }
      try {
        // Registry-only creation: the agent document carries its home
        // scopeKey; no scope-assignment link is ever written.
        return await source.saveAgent(valid);
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateAgentSlugError(valid.slug);
        throw error;
      }
    },

    async attachSkill(input: AttachAgentSkillInput): Promise<AgentSkill> {
      const valid = attachAgentSkillInputSchema.parse(input);
      await requireAgent(valid.agentKey);
      if (!await source.findSkillByKey(valid.skillKey)) {
        throw new AgentReferenceNotFoundError('skill', valid.skillKey);
      }
      if (await source.findAgentSkill(valid.agentKey, valid.skillKey)) {
        throw new DuplicateAgentLinkError('skill', valid.agentKey, valid.skillKey);
      }
      try {
        return await source.saveAgentSkill(valid);
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateAgentLinkError('skill', valid.agentKey, valid.skillKey);
        throw error;
      }
    },
  };
}

function createDefaultAgentServiceDataSource(): AgentServiceDataSource {
  const scopes = getDefaultScopeRepository();
  return {
    findAgentByKey: getAgentById,
    findAgentBySlug: getAgentBySlug,
    findScopeByKey: scopes.getScopeByKey,
    findSkillByKey: getSkillById,
    findAgentSkill: getAgentSkillByPair,
    saveAgent: insertAgent,
    saveAgentSkill: insertAgentSkill,
  };
}
