import { join } from 'node:path';
import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { getToolBySlug, type Tool } from '@/lib/db/tools.node';
import { getActionBySlug } from '@/lib/db/actions.node';
import { getToolActionByPair } from '@/lib/db/tool-actions.node';
import { getModelBySlug } from '@/lib/db/models.node';
import { getModelActionByPair } from '@/lib/db/model-actions.node';
import { getProviderBySlug } from '@/lib/db/providers.node';
import { getModelProviderByPair } from '@/lib/db/model-providers.node';
import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers';
import { getSkillBySlug, insertSkill, updateSkill, type Skill } from '@/lib/db/skills.node';
import { getAgentBySlug, insertAgent, updateAgent, type Agent } from '@/lib/db/agents.node';
import { getAgentSkillByPair, insertAgentSkill, updateAgentSkillPriority, type AgentSkill } from '@/lib/db/agent-skills.node';
import { getAgentToolByPair, insertAgentTool, type AgentTool } from '@/lib/db/agent-tools.node';
import { loadAgentRuntime } from '@/lib/ai/agents';
import { cuidSchema, kebabSlugSchema } from './schemas';

export const GENESIS_AGENT_KEY = cuidSchema.parse('cmgenesis00000000000000001');
export const AGENT_ARCHITECT_SKILL_KEY = cuidSchema.parse('cmskillarchitect00000000001');
export const GENESIS_AGENT_SKILL_KEY = cuidSchema.parse('cmgenesisagentskill0000001');
export const GENESIS_AGENT_TOOL_KEY = cuidSchema.parse('cmgenesisagenttool00000001');
export const GENESIS_SCOPE_SLUG = 'agent-builder';
export const GENESIS_REASON_TOOL_SLUG = 'reason.solve' as const;

const genesisSeedSchema = z.object({
  version: z.literal(1),
  seed: z.object({
    skills: z.array(z.object({ key: cuidSchema, slug: kebabSlugSchema, name: z.string(), title: z.string(), definitionFile: z.string(), embedding: z.array(z.number()) }).strict()).length(1),
    agents: z.array(z.object({ key: cuidSchema, slug: kebabSlugSchema, name: z.string(), title: z.string(), scopeSlug: kebabSlugSchema, explorationRate: z.number().min(0).max(1), embedding: z.array(z.number()) }).strict()).length(1),
    agentSkills: z.array(z.object({ key: cuidSchema, agentSlug: kebabSlugSchema, skillSlug: kebabSlugSchema, priority: z.number().int().nonnegative() }).strict()).length(1),
    agentTools: z.array(z.object({ key: cuidSchema, agentSlug: kebabSlugSchema, toolSlug: z.literal(GENESIS_REASON_TOOL_SLUG) }).strict()).length(1),
  }).strict(),
}).strict();

export type GenesisSeed = z.infer<typeof genesisSeedSchema>;

export class GenesisSeedPrerequisiteError extends AiError {
  constructor(detail: string) { super('genesis_seed_prerequisite_missing', `Cannot seed Genesis: ${detail}`); }
}

export interface GenesisSeedDataSource {
  requireOrganization(key: string): Promise<Organization | null>;
  findScope(organizationKey: string, slug: string): Promise<Scope | null>;
  requireReasonTool(): Promise<Tool | null>;
  verifyReasonRoute(organizationKey: string, toolKey: string): Promise<boolean>;
  upsertSkill(seed: GenesisSeed['seed']['skills'][number], definition: string): Promise<Skill>;
  upsertAgent(seed: GenesisSeed['seed']['agents'][number], scopeKey: string): Promise<Agent>;
  upsertAgentSkill(seed: GenesisSeed['seed']['agentSkills'][number], agentKey: string, skillKey: string): Promise<AgentSkill>;
  upsertAgentTool(seed: GenesisSeed['seed']['agentTools'][number], agentKey: string, toolKey: string): Promise<AgentTool>;
  verifyRuntime(agentKey: string): Promise<void>;
}

export async function loadGenesisSeedFiles(): Promise<{ seed: GenesisSeed; definition: string }> {
  const seed = genesisSeedSchema.parse(await Bun.file(join(import.meta.dir, 'seed/genesis.seed.json')).json());
  const definition = (await Bun.file(join(import.meta.dir, 'seed/agent-architect.skill.md')).text()).trim();
  if (!definition.startsWith('# Agent Architect')) throw new GenesisSeedPrerequisiteError('canonical skill definition is invalid');
  return { seed, definition };
}

const defaultSeedDataSource: GenesisSeedDataSource = {
  requireOrganization: getOrganizationById,
  async findScope(organizationKey, slug) { return (await getDefaultScopeRepository().listScopes(organizationKey)).find((scope) => scope.slug === slug) ?? null; },
  requireReasonTool: () => getToolBySlug(GENESIS_REASON_TOOL_SLUG),
  async verifyReasonRoute(organizationKey, toolKey) {
    const action = await getActionBySlug('core.reason');
    const model = await getModelBySlug('openai.gpt-5.4-mini');
    const provider = await getProviderBySlug('openai');
    if (!action?.enabled || !model?.enabled || !provider?.enabled) return false;
    const [toolAction, modelAction, modelProvider, organizationEnabled] = await Promise.all([
      getToolActionByPair(toolKey, action.key),
      getModelActionByPair(model.key, action.key),
      getModelProviderByPair(model.key, provider.key),
      getDefaultOrganizationProviderRepository().hasProvider(organizationKey, provider.key),
    ]);
    return toolAction?.enabled === true && modelAction?.enabled === true && modelProvider?.enabled === true && organizationEnabled;
  },
  async upsertSkill(seed, definition) {
    const existing = await getSkillBySlug(seed.slug);
    if (!existing) return insertSkill({ key: seed.key, slug: seed.slug, name: seed.name, title: seed.title, definition });
    return updateSkill(existing.key, { name: seed.name, title: seed.title, definition });
  },
  async upsertAgent(seed, scopeKey) {
    const existing = await getAgentBySlug(seed.slug);
    if (!existing) return insertAgent({ key: seed.key, slug: seed.slug, name: seed.name, title: seed.title, scopeKey, explorationRate: seed.explorationRate });
    return updateAgent(existing.key, { name: seed.name, title: seed.title, scopeKey, explorationRate: seed.explorationRate });
  },
  async upsertAgentSkill(seed, agentKey, skillKey) {
    const existing = await getAgentSkillByPair(agentKey, skillKey);
    if (!existing) return insertAgentSkill({ key: seed.key, agentKey, skillKey, priority: seed.priority });
    return existing.priority === seed.priority ? existing : updateAgentSkillPriority(existing.key, seed.priority);
  },
  async upsertAgentTool(seed, agentKey, toolKey) {
    return await getAgentToolByPair(agentKey, toolKey) ?? insertAgentTool({ key: seed.key, agentKey, toolKey });
  },
  async verifyRuntime(agentKey) {
    const runtime = await loadAgentRuntime(agentKey);
    const architectSkills = runtime.skills.filter(({ skill }) => skill.slug === 'agent-architect');
    if (architectSkills.length !== 1 || architectSkills[0]?.relation.priority !== 100) throw new GenesisSeedPrerequisiteError('Genesis must have one priority-100 Agent Architect skill');
    const reason = runtime.tools.find(({ tool }) => tool.slug === GENESIS_REASON_TOOL_SLUG);
    if (!reason?.actions.some(({ action }) => action.slug === 'core.reason')) throw new GenesisSeedPrerequisiteError('Reason Tool must expose core.reason');
  },
};

export interface SeedGenesisResult {
  organizationKey: string;
  scope: Scope;
  skill: Skill;
  agent: Agent;
  agentSkill: AgentSkill;
  agentTool: AgentTool;
  reasonTool: Tool;
}

/** Idempotently seeds only Genesis, its one skill, and its Reason Tool grant. */
export async function seedGenesis(organizationKey: string, source: GenesisSeedDataSource = defaultSeedDataSource): Promise<SeedGenesisResult> {
  const validOrganizationKey = cuidSchema.parse(organizationKey);
  const [{ seed, definition }, organization] = await Promise.all([loadGenesisSeedFiles(), source.requireOrganization(validOrganizationKey)]);
  if (!organization) throw new GenesisSeedPrerequisiteError(`organization ${validOrganizationKey}`);
  const agentSeed = seed.seed.agents[0]!; const skillSeed = seed.seed.skills[0]!;
  const relationSeed = seed.seed.agentSkills[0]!; const toolSeed = seed.seed.agentTools[0]!;
  const scope = await source.findScope(validOrganizationKey, agentSeed.scopeSlug);
  if (!scope || scope.organizationKey !== validOrganizationKey) throw new GenesisSeedPrerequisiteError(`scope ${agentSeed.scopeSlug}`);
  const reasonTool = await source.requireReasonTool();
  if (!reasonTool || reasonTool.slug !== toolSeed.toolSlug || !reasonTool.enabled) throw new GenesisSeedPrerequisiteError(`tool ${toolSeed.toolSlug}`);
  if (!await source.verifyReasonRoute(validOrganizationKey, reasonTool.key)) throw new GenesisSeedPrerequisiteError('core.reason → GPT-5.4 Mini → OpenAI route');
  const skill = await source.upsertSkill(skillSeed, definition);
  const agent = await source.upsertAgent(agentSeed, scope.key);
  const agentSkill = await source.upsertAgentSkill(relationSeed, agent.key, skill.key);
  const agentTool = await source.upsertAgentTool(toolSeed, agent.key, reasonTool.key);
  await source.verifyRuntime(agent.key);
  return { organizationKey: validOrganizationKey, scope, skill, agent, agentSkill, agentTool, reasonTool };
}
