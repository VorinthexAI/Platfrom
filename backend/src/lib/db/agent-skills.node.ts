import { aql } from 'arangojs';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { db } from './client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from './base';

export const AGENT_SKILLS_COLLECTION = 'agentSkills';

export const agentSkillSchema = z.object({
  key: z.string().cuid2(),
  agentKey: z.string().cuid2(),
  skillKey: z.string().cuid2(),
  priority: z.number().int().nonnegative(),
});

export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type AgentSkillInsert = Omit<z.input<typeof agentSkillSchema>, 'key'> & { key?: string };

export async function insertAgentSkill(input: AgentSkillInsert): Promise<AgentSkill> {
  const link = agentSkillSchema.parse({ ...input, key: input.key ?? newId() });
  const result = await db.collection(AGENT_SKILLS_COLLECTION).save(toArangoDoc(link), { returnNew: true });
  return agentSkillSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}

export async function getAgentSkillById(key: string): Promise<AgentSkill | null> {
  try {
    const doc = await db.collection(AGENT_SKILLS_COLLECTION).document(key);
    return agentSkillSchema.parse(withArangoKey(doc as Record<string, unknown>));
  } catch (error) {
    if (isArangoNotFoundError(error)) return null;
    throw error;
  }
}

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

export async function deleteAgentSkill(key: string): Promise<void> {
  await db.collection(AGENT_SKILLS_COLLECTION).remove(key);
}
