import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { db } from '@/lib/db/client';
import { toArangoDoc } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENTS_COLLECTION, agentSchema, type Agent } from '@/lib/db/agents.node';
import { SKILLS_COLLECTION, skillSchema, type Skill } from '@/lib/db/skills.node';
import { AGENT_SKILLS_COLLECTION, agentSkillSchema, type AgentSkill } from '@/lib/db/agent-skills.node';
import { AGENT_TOOLS_COLLECTION, agentToolSchema, type AgentTool } from '@/lib/db/agent-tools.node';
import { TOOLS_COLLECTION } from '@/lib/db/tools.node';
import { ACTIONS_COLLECTION } from '@/lib/db/actions.node';
import { TOOL_ACTIONS_COLLECTION } from '@/lib/db/tool-actions.node';
import { ORGANIZATIONS_COLLECTION } from '@/lib/db/organizations.node';
import { SCOPES_COLLECTION } from '@/lib/ai/scopes';
import { SCOPE_MEMBERS_COLLECTION } from '@/lib/ai/scopes/schema';
import { SCOPE_AGENTS_COLLECTION, accessRoleSchema, scopeAgentSchema, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { AGENT_MEMBERS_COLLECTION, agentMemberSchema, type AgentMember } from '@/lib/db/agent-members.node';
import { AGENT_ARTIFACTS_COLLECTION, agentArtifactSchema, type AgentArtifact } from '@/lib/ai/agent-artifacts';
import { AGENT_ARTIFACT_CHECKS_COLLECTION } from '@/lib/ai/agent-artifact-checks';
import { AGENT_RUN_SOURCES_COLLECTION } from '@/lib/ai/agent-run-sources';
import type { GenesisContext } from './context';
import type { ValidatedGenesisManifest } from './validation';

export class GenesisPersistenceError extends AiError {
  constructor(detail: string) { super('genesis_persistence_invalid', `Cannot persist Genesis manifest: ${detail}`); }
}

export const GENESIS_TRANSACTION_COLLECTIONS = {
  write: [AGENTS_COLLECTION, SKILLS_COLLECTION, AGENT_SKILLS_COLLECTION, AGENT_TOOLS_COLLECTION, SCOPE_AGENTS_COLLECTION, AGENT_MEMBERS_COLLECTION, AGENT_ARTIFACTS_COLLECTION, AGENT_ARTIFACT_CHECKS_COLLECTION],
  read: [ORGANIZATIONS_COLLECTION, SCOPES_COLLECTION, AGENTS_COLLECTION, SKILLS_COLLECTION, TOOLS_COLLECTION, ACTIONS_COLLECTION, TOOL_ACTIONS_COLLECTION, SCOPE_MEMBERS_COLLECTION, AGENT_RUN_SOURCES_COLLECTION],
} as const;
export type GenesisWriteCollection = typeof GENESIS_TRANSACTION_COLLECTIONS.write[number];

export interface GenesisTransactionWriter {
  save(collection: GenesisWriteCollection, document: Record<string, unknown> & { key: string }): Promise<void>;
}
export interface GenesisTransactionGateway {
  execute<T>(callback: (writer: GenesisTransactionWriter) => Promise<T>): Promise<T>;
}

export const arangoGenesisTransactionGateway: GenesisTransactionGateway = {
  async execute(callback) {
    const trx = await db.beginTransaction({
      write: [...GENESIS_TRANSACTION_COLLECTIONS.write],
      read: [...GENESIS_TRANSACTION_COLLECTIONS.read],
      exclusive: [...GENESIS_TRANSACTION_COLLECTIONS.write],
    });
    try {
      const result = await callback({
        async save(collection, document) { await trx.step(() => db.collection(collection).save(toArangoDoc(document))); },
      });
      await trx.commit();
      return result;
    } catch (error) {
      await trx.abort();
      throw error;
    }
  },
};

export interface PersistGenesisManifestInput {
  runKey: string;
  context: GenesisContext;
  validated: ValidatedGenesisManifest;
  /** Trusted placement calculated from persisted RBAC state, never from the manifest. */
  placement?: {
    minimumAccessRole: z.infer<typeof accessRoleSchema>;
    position: number;
    createdByUserOrganizationKey: string | null;
    inheritedUserOrganizationKeys: readonly string[];
  };
}
export interface PersistGenesisManifestResult {
  agent: Agent;
  createdSkills: readonly Skill[];
  agentSkills: readonly AgentSkill[];
  agentTools: readonly AgentTool[];
  scopeAgent: ScopeAgent | null;
  agentMembers: readonly AgentMember[];
  artifacts: readonly AgentArtifact[];
}

/** Persists the complete configuration and provenance in one stream transaction. */
export async function persistGenesisManifest(
  input: PersistGenesisManifestInput,
  gateway: GenesisTransactionGateway = arangoGenesisTransactionGateway,
): Promise<PersistGenesisManifestResult> {
  const { manifest, plan } = input.validated;
  if (manifest.metadata.status !== 'accepted' || !manifest.validation.readyToPersist) throw new GenesisPersistenceError('manifest is not accepted and ready');
  if (manifest.agent.operation === 'create' && !input.placement) throw new GenesisPersistenceError('new agents require a trusted initial scope placement');
  const existingAgents = new Map(input.context.knowledge.existingAgents.map((agent) => [agent.key, agent]));
  const existingSkills = new Map(input.context.knowledge.existingSkills.map((skill) => [skill.key, skill]));
  const existingTools = new Map(input.context.knowledge.existingTools.map((tool) => [tool.key, tool]));

  return gateway.execute(async (writer) => {
    const createdSkills = new Map<string, Skill>();
    const artifacts: AgentArtifact[] = [];
    let position = 0;
    async function artifact(nodeType: string, nodeKey: string, relation: AgentArtifact['relation'], groupKey: string | null) {
      const value = agentArtifactSchema.parse({ key: newId(), agentRunKey: input.runKey, nodeType, nodeKey, relation, groupKey, position });
      position += 1;
      await writer.save(AGENT_ARTIFACTS_COLLECTION, value);
      artifacts.push(value);
    }

    await artifact('scope', input.context.scope.key, 'source', null);

    for (const operation of manifest.skills) {
      if (operation.operation === 'reuse') continue;
      const planned = plan.skills[operation.slug];
      if (!planned) throw new GenesisPersistenceError(`missing plan for skill ${operation.slug}`);
      const skill = skillSchema.parse({ key: planned.key, slug: operation.slug, name: operation.name, title: operation.title, definition: operation.definition, embedding: planned.embedding });
      await writer.save(SKILLS_COLLECTION, skill);
      createdSkills.set(operation.slug, skill);
      await artifact('skill', skill.key, 'result', null);
    }

    let agent: Agent;
    if (manifest.agent.operation === 'reuse') {
      const existing = existingAgents.get(manifest.agent.agentKey);
      if (!existing) throw new GenesisPersistenceError(`missing reused agent ${manifest.agent.agentKey}`);
      agent = existing;
      await artifact('agent', agent.key, 'source', agent.key);
    } else {
      if (!plan.agentKey || !plan.agentEmbedding) throw new GenesisPersistenceError('missing new agent plan');
      agent = agentSchema.parse({ key: plan.agentKey, slug: manifest.agent.slug, name: manifest.agent.name, title: manifest.agent.title, scopeKey: manifest.agent.scopeKey, explorationRate: manifest.agent.explorationRate, embedding: plan.agentEmbedding });
      await writer.save(AGENTS_COLLECTION, agent);
      await artifact('agent', agent.key, 'result', agent.key);
    }

    let scopeAgent: ScopeAgent | null = null;
    const createdAgentMembers: AgentMember[] = [];
    if (manifest.agent.operation === 'create' && input.placement) {
      const timestamp = new Date().toISOString();
      scopeAgent = scopeAgentSchema.parse({
        key: newId(), organizationKey: input.context.organization.key, scopeKey: input.context.scope.key,
        agentKey: agent.key, position: input.placement.position, status: 'active',
        minimumAccessRole: input.placement.minimumAccessRole,
        createdByUserOrganizationKey: input.placement.createdByUserOrganizationKey,
        createdAt: timestamp, updatedAt: timestamp, embedding: [],
      });
      await writer.save(SCOPE_AGENTS_COLLECTION, scopeAgent);
      await artifact('scope-agent', scopeAgent.key, 'result', agent.key);
      for (const userOrganizationKey of [...new Set(input.placement.inheritedUserOrganizationKeys)]) {
        const member = agentMemberSchema.parse({
          key: newId(), organizationKey: input.context.organization.key, scopeKey: input.context.scope.key,
          agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey, source: 'inherited',
          createdByUserOrganizationKey: input.placement.createdByUserOrganizationKey, createdAt: timestamp, embedding: [],
        });
        await writer.save(AGENT_MEMBERS_COLLECTION, member);
        createdAgentMembers.push(member);
        await artifact('agent-member', member.key, 'result', agent.key);
      }
    }

    const createdAgentSkills: AgentSkill[] = [];
    const createdAgentTools: AgentTool[] = [];
    const sourcedSkills = new Set<string>();
    const sourcedTools = new Set<string>();
    for (const relation of manifest.agentSkills) {
      const skill = relation.skillRef.type === 'existing'
        ? existingSkills.get(relation.skillRef.skillKey)
        : createdSkills.get(relation.skillRef.skillSlug);
      if (!skill) throw new GenesisPersistenceError('agentSkills reference did not resolve');
      if (relation.skillRef.type === 'existing' && !sourcedSkills.has(skill.key)) {
        sourcedSkills.add(skill.key); await artifact('skill', skill.key, 'source', agent.key);
      }
      if (manifest.agent.operation === 'reuse') continue;
      const link = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: relation.priority });
      await writer.save(AGENT_SKILLS_COLLECTION, link);
      createdAgentSkills.push(link);
      await artifact('agent-skill', link.key, 'result', agent.key);
    }

    for (const operation of manifest.agentTools) {
      const tool = existingTools.get(operation.toolKey);
      if (!tool) throw new GenesisPersistenceError(`missing tool ${operation.toolKey}`);
      if (!sourcedTools.has(tool.key)) {
        sourcedTools.add(tool.key); await artifact('tool', tool.key, 'source', agent.key);
      }
      if (manifest.agent.operation === 'reuse') continue;
      const link = agentToolSchema.parse({ key: newId(), agentKey: agent.key, toolKey: tool.key });
      await writer.save(AGENT_TOOLS_COLLECTION, link);
      createdAgentTools.push(link);
      await artifact('agent-tool', link.key, 'result', agent.key);
    }

    return { agent, createdSkills: [...createdSkills.values()], agentSkills: createdAgentSkills, agentTools: createdAgentTools, scopeAgent, agentMembers: createdAgentMembers, artifacts };
  });
}
