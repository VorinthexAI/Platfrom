import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const AGENTS_COLLECTION = 'agents';

export const agentSchema = z.object({
  key: z.string(),
  orchestratorId: z.string(),
  name: z.string(),
  role: z.string(),
  model: z.string(),
  storagePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Agent = z.infer<typeof agentSchema>;

export const agentsEmbedKeys = z.enum(['name', 'role', 'model']);

const helpers = createNodeHelpers(AGENTS_COLLECTION, agentSchema, agentsEmbedKeys.options);

export const insertAgent = helpers.insert;
export const getAgentById = helpers.getById;
export const updateAgent = helpers.updateById;
export const deleteAgent = helpers.deleteById;
export const upsertAgentByKey = helpers.upsertByKey;
export const getAllAgentsChunked = helpers.getAllChunked;
export const listAgentsPage = helpers.listPage;

export async function listAgentsByOrchestratorId(orchestratorId: string): Promise<Agent[]> {
  const cursor = await db.query(aql`
    FOR agent IN ${db.collection(AGENTS_COLLECTION)}
      FILTER agent.orchestratorId == ${orchestratorId}
      SORT agent.name ASC, agent._key ASC
      RETURN agent
  `);
  const docs = await cursor.all();
  return docs.map((doc) => agentSchema.parse(withArangoKey(doc)));
}
