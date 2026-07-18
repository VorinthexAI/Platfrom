import { join } from 'node:path';
import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getOrganizationById } from '@/lib/db/organizations.node';
import { getDefaultScopeRepository, type Scope } from '@/lib/ai/scopes';
import { getToolBySlug, type Tool } from '@/lib/db/tools.node';
import { getSkillBySlug, insertSkill, updateSkill, type Skill } from '@/lib/db/skills.node';
import { getAgentBySlug, insertAgent, updateAgent, type Agent } from '@/lib/db/agents.node';
import { deleteAgentSkill, getAgentSkillByPair, insertAgentSkill, listAgentSkillsByAgentKey, updateAgentSkillPriority, type AgentSkill } from '@/lib/db/agent-skills.node';
import { deleteAgentTool, getAgentToolByPair, insertAgentTool, listAgentToolsByAgentKey, type AgentTool } from '@/lib/db/agent-tools.node';
import { loadAgentRuntime } from '@/lib/ai/agents';
import { cuidSchema } from '@/lib/ai/genesis/schemas';

/**
 * Beacon is the canonical system agent behind Founders Gate: one immutable
 * slug the backend resolves server-side, never an agent key accepted from a
 * client. It lives in the root organization's Nexus scope and is granted the
 * conversational ask/reason tools plus the narrow local delegation boundary.
 */
export const BEACON_AGENT_SLUG = 'beacon' as const;
export const BEACON_AGENT_NAME = 'Beacon';
export const BEACON_AGENT_TITLE = 'AI Coordinator';
export const BEACON_SCOPE_SLUG = 'nexus';
export const BEACON_SKILL_SLUG = 'beacon-coordination';
export const BEACON_ASK_TOOL_SLUG = 'ask.answer' as const;
export const BEACON_REASON_TOOL_SLUG = 'reason.solve' as const;
export const BEACON_DELEGATE_TOOL_SLUG = 'core.delegate' as const;

export const BEACON_AGENT_KEY = cuidSchema.parse('cmbeaconagent0000000000001');
export const BEACON_SKILL_KEY = cuidSchema.parse('cmbeaconskill0000000000001');
export const BEACON_AGENT_SKILL_KEY = cuidSchema.parse('cmbeaconagentskill00000001');
export const BEACON_AGENT_TOOL_ASK_KEY = cuidSchema.parse('cmbeaconagenttoolask000001');
export const BEACON_AGENT_TOOL_REASON_KEY = cuidSchema.parse('cmbeaconagenttoolreason001');
export const BEACON_AGENT_TOOL_DELEGATE_KEY = cuidSchema.parse('cmbeaconagenttooldelegate01');

export class BeaconSeedPrerequisiteError extends AiError {
  constructor(detail: string) {
    super('beacon_seed_prerequisite_missing', `Cannot seed Beacon: ${detail}`);
  }
}

export interface SeedBeaconResult {
  organizationKey: string;
  scope: Scope;
  skill: Skill;
  agent: Agent;
  agentSkill: AgentSkill;
  agentTools: AgentTool[];
  tools: Tool[];
}

async function loadBeaconSkillDefinition(): Promise<string> {
  const definition = (await Bun.file(join(import.meta.dir, 'seed/beacon.skill.md')).text()).trim();
  if (!definition.startsWith('# Beacon')) throw new BeaconSeedPrerequisiteError('canonical skill definition is invalid');
  return definition;
}

/** Idempotently seeds Beacon into the organization's Nexus scope with ask + reason grants. */
export async function seedBeacon(organizationKey: string): Promise<SeedBeaconResult> {
  const validOrganizationKey = z.string().trim().min(1).parse(organizationKey);
  const [definition, organization] = await Promise.all([
    loadBeaconSkillDefinition(),
    getOrganizationById(validOrganizationKey),
  ]);
  if (!organization) throw new BeaconSeedPrerequisiteError(`organization ${validOrganizationKey}`);

  const scope = (await getDefaultScopeRepository().listScopes(validOrganizationKey))
    .find((candidate) => candidate.slug === BEACON_SCOPE_SLUG) ?? null;
  if (!scope) throw new BeaconSeedPrerequisiteError(`scope ${BEACON_SCOPE_SLUG}`);

  const toolSeeds = [
    { slug: BEACON_ASK_TOOL_SLUG, relationKey: BEACON_AGENT_TOOL_ASK_KEY },
    { slug: BEACON_REASON_TOOL_SLUG, relationKey: BEACON_AGENT_TOOL_REASON_KEY },
    { slug: BEACON_DELEGATE_TOOL_SLUG, relationKey: BEACON_AGENT_TOOL_DELEGATE_KEY },
  ] as const;
  const tools: Tool[] = [];
  for (const seed of toolSeeds) {
    const tool = await getToolBySlug(seed.slug);
    if (!tool || !tool.enabled) throw new BeaconSeedPrerequisiteError(`tool ${seed.slug}`);
    tools.push(tool);
  }

  const existingSkill = await getSkillBySlug(BEACON_SKILL_SLUG);
  const skill = existingSkill
    ? await updateSkill(existingSkill.key, { name: BEACON_AGENT_NAME, title: BEACON_AGENT_TITLE, definition })
    : await insertSkill({ key: BEACON_SKILL_KEY, slug: BEACON_SKILL_SLUG, name: BEACON_AGENT_NAME, title: BEACON_AGENT_TITLE, definition });

  const existingAgent = await getAgentBySlug(BEACON_AGENT_SLUG);
  const agent = existingAgent
    ? await updateAgent(existingAgent.key, { name: BEACON_AGENT_NAME, title: BEACON_AGENT_TITLE, scopeKey: scope.key, explorationRate: 0.2 })
    : await insertAgent({ key: BEACON_AGENT_KEY, slug: BEACON_AGENT_SLUG, name: BEACON_AGENT_NAME, title: BEACON_AGENT_TITLE, scopeKey: scope.key, explorationRate: 0.2 });

  const existingAgentSkill = await getAgentSkillByPair(agent.key, skill.key);
  const agentSkill = existingAgentSkill
    ? (existingAgentSkill.priority === 100 ? existingAgentSkill : await updateAgentSkillPriority(existingAgentSkill.key, 100))
    : await insertAgentSkill({ key: BEACON_AGENT_SKILL_KEY, agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const otherSkills = (await listAgentSkillsByAgentKey(agent.key)).filter(({ skillKey }) => skillKey !== skill.key);
  await Promise.all(otherSkills.map(({ key }) => deleteAgentSkill(key)));

  const agentTools: AgentTool[] = [];
  for (const [index, seed] of toolSeeds.entries()) {
    const tool = tools[index]!;
    agentTools.push(await getAgentToolByPair(agent.key, tool.key)
      ?? await insertAgentTool({ key: seed.relationKey, agentKey: agent.key, toolKey: tool.key }));
  }
  const allowedToolKeys = new Set(tools.map(({ key }) => key));
  const otherTools = (await listAgentToolsByAgentKey(agent.key)).filter(({ toolKey }) => !allowedToolKeys.has(toolKey));
  await Promise.all(otherTools.map(({ key }) => deleteAgentTool(key)));

  const runtime = await loadAgentRuntime(agent.key);
  const beaconSkills = runtime.skills.filter(({ skill: runtimeSkill }) => runtimeSkill.slug === BEACON_SKILL_SLUG);
  if (runtime.skills.length !== 1 || beaconSkills.length !== 1 || beaconSkills[0]?.relation.priority !== 100) {
    throw new BeaconSeedPrerequisiteError('Beacon must expose exactly one priority-100 coordination skill');
  }
  const askGrant = runtime.tools.find(({ tool }) => tool.slug === BEACON_ASK_TOOL_SLUG);
  const reasonGrant = runtime.tools.find(({ tool }) => tool.slug === BEACON_REASON_TOOL_SLUG);
  const delegateGrant = runtime.tools.find(({ tool }) => tool.slug === BEACON_DELEGATE_TOOL_SLUG);
  if (runtime.tools.length !== 3 || askGrant?.actions.length !== 1 || askGrant.actions[0]?.action.slug !== 'core.ask') {
    throw new BeaconSeedPrerequisiteError('Beacon must expose only ask.answer, reason.solve, and core.delegate with their canonical actions');
  }
  if (reasonGrant?.actions.length !== 1 || reasonGrant.actions[0]?.action.slug !== 'core.reason') {
    throw new BeaconSeedPrerequisiteError('Beacon must expose only ask.answer, reason.solve, and core.delegate with their canonical actions');
  }
  if (delegateGrant?.actions.length !== 1 || delegateGrant.actions[0]?.action.slug !== 'core.delegate') {
    throw new BeaconSeedPrerequisiteError('Beacon must expose only ask.answer, reason.solve, and core.delegate with their canonical actions');
  }

  return { organizationKey: validOrganizationKey, scope, skill, agent, agentSkill, agentTools, tools };
}
