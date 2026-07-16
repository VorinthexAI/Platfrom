import { aql } from 'arangojs';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { db } from './client';
import { createEdgeHelpers, withArangoKey } from './base';

export const AGENT_SKILLS_COLLECTION = 'agentSkills';

export const agentSkillSchema = z.object({
  key: z.string().cuid(),
  agentKey: z.string().cuid(),
  skillKey: z.string().cuid(),
  priority: z.number().int().nonnegative().default(100),
});

export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type AgentSkillInsert = Omit<z.input<typeof agentSkillSchema>, 'key'> & { key?: string };

const helpers = createEdgeHelpers(AGENT_SKILLS_COLLECTION, agentSkillSchema);

export async function insertAgentSkill(input: AgentSkillInsert): Promise<AgentSkill> {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getAgentSkillById = helpers.getById;

export async function getAgentSkillByPair(agentKey: string, skillKey: string): Promise<AgentSkill | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(AGENT_SKILLS_COLLECTION)}
      FILTER link.agentKey == ${agentKey} && link.skillKey == ${skillKey}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? agentSkillSchema.parse(withArangoKey(doc)) : null;
}

export async function listAgentSkillsByAgentKey(agentKey: string): Promise<AgentSkill[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(AGENT_SKILLS_COLLECTION)}
      FILTER link.agentKey == ${agentKey}
      SORT link.priority DESC, link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => agentSkillSchema.parse(withArangoKey(doc)));
}

export async function listAgentSkillsBySkillKey(skillKey: string): Promise<AgentSkill[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(AGENT_SKILLS_COLLECTION)}
      FILTER link.skillKey == ${skillKey}
      SORT link.priority DESC, link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => agentSkillSchema.parse(withArangoKey(doc)));
}

export async function updateAgentSkillPriority(key: string, priority: number): Promise<AgentSkill> {
  const validPriority = agentSkillSchema.shape.priority.parse(priority);
  const result = await db.collection(AGENT_SKILLS_COLLECTION).update(key, { priority: validPriority }, { returnNew: true });
  return agentSkillSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}

export const deleteAgentSkill = helpers.deleteById;
export const upsertAgentSkillByKey = helpers.upsertByKey;
export const getAllAgentSkillsChunked = helpers.getAllChunked;
export const listAgentSkillsPage = helpers.listPage;
