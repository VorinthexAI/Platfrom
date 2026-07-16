import { aql } from 'arangojs';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { db } from './client';
import { createEdgeHelpers, withArangoKey } from './base';

export const AGENT_TOOLS_COLLECTION = 'agentTools';

export const agentToolSchema = z.object({
  key: z.string().cuid(),
  agentKey: z.string().cuid(),
  toolKey: z.string().cuid(),
});

export type AgentTool = z.infer<typeof agentToolSchema>;
export type AgentToolInsert = Omit<z.input<typeof agentToolSchema>, 'key'> & { key?: string };

const helpers = createEdgeHelpers(AGENT_TOOLS_COLLECTION, agentToolSchema);

export async function insertAgentTool(input: AgentToolInsert): Promise<AgentTool> {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getAgentToolById = helpers.getById;

export async function getAgentToolByPair(agentKey: string, toolKey: string): Promise<AgentTool | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(AGENT_TOOLS_COLLECTION)}
      FILTER link.agentKey == ${agentKey} && link.toolKey == ${toolKey}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? agentToolSchema.parse(withArangoKey(doc)) : null;
}

export async function listAgentToolsByAgentKey(agentKey: string): Promise<AgentTool[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(AGENT_TOOLS_COLLECTION)}
      FILTER link.agentKey == ${agentKey}
      SORT link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => agentToolSchema.parse(withArangoKey(doc)));
}

export const deleteAgentTool = helpers.deleteById;
export const upsertAgentToolByKey = helpers.upsertByKey;
export const getAllAgentToolsChunked = helpers.getAllChunked;
export const listAgentToolsPage = helpers.listPage;
