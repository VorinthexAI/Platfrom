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
import {
  getAgentToolByPair,
  insertAgentTool,
  type AgentTool,
} from '@/lib/db/agent-tools.node';
import { getSkillById, type Skill } from '@/lib/db/skills.node';
import { getToolById, type Tool } from '@/lib/db/tools.node';
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

export const grantAgentToolInputSchema = z.object({
  agentKey: z.string().cuid(),
  toolKey: z.string().cuid(),
}).strict();

export type CreateAgentInput = z.input<typeof createAgentInputSchema>;
export type AttachAgentSkillInput = z.input<typeof attachAgentSkillInputSchema>;
export type GrantAgentToolInput = z.input<typeof grantAgentToolInputSchema>;

export interface AgentServiceDataSource {
  findAgentByKey(key: string): Promise<Agent | null>;
  findAgentBySlug(slug: string): Promise<Agent | null>;
  findScopeByKey(key: string): Promise<Scope | null>;
  findSkillByKey(key: string): Promise<Skill | null>;
  findToolByKey(key: string): Promise<Tool | null>;
  findAgentSkill(agentKey: string, skillKey: string): Promise<AgentSkill | null>;
  findAgentTool(agentKey: string, toolKey: string): Promise<AgentTool | null>;
  saveAgent(input: CreateAgentInput): Promise<Agent>;
  saveAgentSkill(input: AttachAgentSkillInput): Promise<AgentSkill>;
  saveAgentTool(input: GrantAgentToolInput): Promise<AgentTool>;
}

export class AgentReferenceNotFoundError extends Error {
  constructor(public readonly reference: 'agent' | 'scope' | 'skill' | 'tool', public readonly key: string) {
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
  constructor(public readonly relation: 'skill' | 'tool', public readonly agentKey: string, public readonly targetKey: string) {
    super(`Agent ${agentKey} already has ${relation} ${targetKey}`);
    this.name = 'DuplicateAgentLinkError';
  }
}

export class RestrictedAgentToolGrantError extends Error {
  constructor(public readonly toolSlug: string, detail = `${toolSlug} may only be granted to the canonical Beacon agent`) { super(detail); this.name = 'RestrictedAgentToolGrantError'; }
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

    async grantTool(input: GrantAgentToolInput): Promise<AgentTool> {
      const valid = grantAgentToolInputSchema.parse(input);
      const agent = await requireAgent(valid.agentKey);
      const tool = await source.findToolByKey(valid.toolKey);
      if (!tool) {
        throw new AgentReferenceNotFoundError('tool', valid.toolKey);
      }
      if (tool.slug === 'core.delegate' && agent.slug !== 'beacon') throw new RestrictedAgentToolGrantError(tool.slug);
      if (agent.slug === 'beacon' && tool.slug !== 'core.delegate') throw new RestrictedAgentToolGrantError(tool.slug, 'the canonical Beacon agent may only be granted core.delegate');
      if (await source.findAgentTool(valid.agentKey, valid.toolKey)) {
        throw new DuplicateAgentLinkError('tool', valid.agentKey, valid.toolKey);
      }
      try {
        return await source.saveAgentTool(valid);
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateAgentLinkError('tool', valid.agentKey, valid.toolKey);
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
    findToolByKey: getToolById,
    findAgentSkill: getAgentSkillByPair,
    findAgentTool: getAgentToolByPair,
    saveAgent: insertAgent,
    saveAgentSkill: insertAgentSkill,
    saveAgentTool: insertAgentTool,
  };
}
