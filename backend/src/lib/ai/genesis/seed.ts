import { join } from 'node:path';
import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { getToolBySlug, type Tool } from '@/lib/db/tools.node';
import { getActionById, getActionBySlug } from '@/lib/db/actions.node';
import { deleteToolAction, getToolActionByPair, listToolActionsByToolKey } from '@/lib/db/tool-actions.node';
import { getModelBySlug } from '@/lib/db/models.node';
import { getModelActionByPair } from '@/lib/db/model-actions.node';
import { getProviderBySlug } from '@/lib/db/providers.node';
import { getModelProviderByPair } from '@/lib/db/model-providers.node';
import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers';
import { getSkillBySlug, insertSkill, updateSkill, type Skill } from '@/lib/db/skills.node';
import { getAgentBySlug, insertAgent, updateAgent, type Agent } from '@/lib/db/agents.node';
import { getAgentSkillByPair, insertAgentSkill, updateAgentSkillPriority, type AgentSkill } from '@/lib/db/agent-skills.node';
import { deleteAgentTool, getAgentToolByPair, insertAgentTool, listAgentToolsByAgentKey, type AgentTool } from '@/lib/db/agent-tools.node';
import { loadAgentRuntime } from '@/lib/ai/agents';
import { cuidSchema, kebabSlugSchema } from './schemas';

export const GENESIS_AGENT_KEY = cuidSchema.parse('cmgenesis00000000000000001');
export const AGENT_ARCHITECT_SKILL_KEY = cuidSchema.parse('cmskillarchitect00000000001');
export const GENESIS_AGENT_SKILL_KEY = cuidSchema.parse('cmgenesisagentskill0000001');
export const GENESIS_AGENT_TOOL_KEY = cuidSchema.parse('cmgenesisagenttoolcreate00001');
export const GENESIS_SCOPE_SLUG = 'agent-builder';
export const GENESIS_CREATE_TOOL_SLUG = 'agent.create' as const;

const genesisSeedSchema = z.object({
  version: z.literal(1),
  seed: z.object({
    skills: z.array(z.object({ key: cuidSchema, slug: kebabSlugSchema, name: z.string(), title: z.string(), definitionFile: z.string(), embedding: z.array(z.number()) }).strict()).length(1),
    agents: z.array(z.object({ key: cuidSchema, slug: kebabSlugSchema, name: z.string(), title: z.string(), scopeSlug: kebabSlugSchema, explorationRate: z.number().min(0).max(1), embedding: z.array(z.number()) }).strict()).length(1),
    agentSkills: z.array(z.object({ key: cuidSchema, agentSlug: kebabSlugSchema, skillSlug: kebabSlugSchema, priority: z.number().int().nonnegative() }).strict()).length(1),
    agentTools: z.array(z.object({ key: cuidSchema, agentSlug: kebabSlugSchema, toolSlug: z.literal(GENESIS_CREATE_TOOL_SLUG) }).strict()).length(1),
  }).strict(),
}).strict();

export type GenesisSeed = z.infer<typeof genesisSeedSchema>;

export class GenesisSeedPrerequisiteError extends AiError {
  constructor(detail: string) { super('genesis_seed_prerequisite_missing', `Cannot seed Genesis: ${detail}`); }
}

export interface GenesisSeedDataSource {
  requireOrganization(key: string): Promise<Organization | null>;
  findScope(organizationKey: string, slug: string): Promise<Scope | null>;
  requireCreateTool(): Promise<Tool | null>;
  removeOtherCreateToolActions(toolKey: string): Promise<void>;
  verifyExecutionChain(organizationKey: string, toolKey: string): Promise<boolean>;
  upsertSkill(seed: GenesisSeed['seed']['skills'][number], definition: string): Promise<Skill>;
  upsertAgent(seed: GenesisSeed['seed']['agents'][number], scopeKey: string): Promise<Agent>;
  upsertAgentSkill(seed: GenesisSeed['seed']['agentSkills'][number], agentKey: string, skillKey: string): Promise<AgentSkill>;
  upsertAgentTool(seed: GenesisSeed['seed']['agentTools'][number], agentKey: string, toolKey: string): Promise<AgentTool>;
  removeOtherAgentTools(agentKey: string, allowedToolKey: string): Promise<void>;
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
  requireCreateTool: () => getToolBySlug(GENESIS_CREATE_TOOL_SLUG),
  async removeOtherCreateToolActions(toolKey) {
    const createAction = await getActionBySlug('agent.create');
    if (!createAction) throw new GenesisSeedPrerequisiteError('action agent.create');
    const links = await listToolActionsByToolKey(toolKey);
    await Promise.all(links.filter(({ actionKey }) => actionKey !== createAction.key).map(({ key }) => deleteToolAction(key)));
  },
  async verifyExecutionChain(organizationKey, toolKey) {
    const [createAction, reasonAction] = await Promise.all([getActionBySlug('agent.create'), getActionBySlug('core.reason')]);
    const model = await getModelBySlug('openai.gpt-5.4-mini');
    const provider = await getProviderBySlug('openai');
    if (!createAction?.enabled || !reasonAction?.enabled || !model?.enabled || !provider?.enabled) return false;
    const [toolAction, toolActions, modelAction, modelProvider, organizationEnabled] = await Promise.all([
      getToolActionByPair(toolKey, createAction.key),
      listToolActionsByToolKey(toolKey),
      getModelActionByPair(model.key, reasonAction.key),
      getModelProviderByPair(model.key, provider.key),
      getDefaultOrganizationProviderRepository().hasProvider(organizationKey, provider.key),
    ]);
    const onlyAction = toolActions.length === 1 ? await getActionById(toolActions[0]!.actionKey) : null;
    return toolAction?.enabled === true && onlyAction?.slug === 'agent.create' && modelAction?.enabled === true && modelProvider?.enabled === true && organizationEnabled;
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
  async removeOtherAgentTools(agentKey, allowedToolKey) {
    const links = await listAgentToolsByAgentKey(agentKey);
    await Promise.all(links.filter(({ toolKey }) => toolKey !== allowedToolKey).map(({ key }) => deleteAgentTool(key)));
  },
  async verifyRuntime(agentKey) {
    const runtime = await loadAgentRuntime(agentKey);
    const architectSkills = runtime.skills.filter(({ skill }) => skill.slug === 'agent-architect');
    if (architectSkills.length !== 1 || architectSkills[0]?.relation.priority !== 100) throw new GenesisSeedPrerequisiteError('Genesis must have one priority-100 Agent Architect skill');
    const create = runtime.tools[0];
    if (runtime.tools.length !== 1 || create?.tool.slug !== GENESIS_CREATE_TOOL_SLUG || create.actions.length !== 1 || create.actions[0]?.action.slug !== 'agent.create') {
      throw new GenesisSeedPrerequisiteError('Genesis must expose only agent.create mapped only to agent.create');
    }
  },
};

export interface SeedGenesisResult {
  organizationKey: string;
  scope: Scope;
  skill: Skill;
  agent: Agent;
  agentSkill: AgentSkill;
  agentTool: AgentTool;
  createTool: Tool;
}

/** Idempotently seeds Genesis with exactly one skill and exactly one agent.create grant. */
export async function seedGenesis(organizationKey: string, source: GenesisSeedDataSource = defaultSeedDataSource): Promise<SeedGenesisResult> {
  const validOrganizationKey = cuidSchema.parse(organizationKey);
  const [{ seed, definition }, organization] = await Promise.all([loadGenesisSeedFiles(), source.requireOrganization(validOrganizationKey)]);
  if (!organization) throw new GenesisSeedPrerequisiteError(`organization ${validOrganizationKey}`);
  const agentSeed = seed.seed.agents[0]!; const skillSeed = seed.seed.skills[0]!;
  const relationSeed = seed.seed.agentSkills[0]!; const toolSeed = seed.seed.agentTools[0]!;
  const scope = await source.findScope(validOrganizationKey, agentSeed.scopeSlug);
  if (!scope || scope.organizationKey !== validOrganizationKey) throw new GenesisSeedPrerequisiteError(`scope ${agentSeed.scopeSlug}`);
  const createTool = await source.requireCreateTool();
  if (!createTool || createTool.slug !== toolSeed.toolSlug || !createTool.enabled) throw new GenesisSeedPrerequisiteError(`tool ${toolSeed.toolSlug}`);
  await source.removeOtherCreateToolActions(createTool.key);
  if (!await source.verifyExecutionChain(validOrganizationKey, createTool.key)) throw new GenesisSeedPrerequisiteError('agent.create grant and core.reason → GPT-5.4 Mini → OpenAI route');
  const skill = await source.upsertSkill(skillSeed, definition);
  const agent = await source.upsertAgent(agentSeed, scope.key);
  const agentSkill = await source.upsertAgentSkill(relationSeed, agent.key, skill.key);
  const agentTool = await source.upsertAgentTool(toolSeed, agent.key, createTool.key);
  await source.removeOtherAgentTools(agent.key, createTool.key);
  await source.verifyRuntime(agent.key);
  return { organizationKey: validOrganizationKey, scope, skill, agent, agentSkill, agentTool, createTool };
}
