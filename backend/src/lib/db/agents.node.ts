import { z } from 'zod';
import { newId } from '@/lib/ids';
import { createNodeHelpers } from './base';

export const AGENTS_COLLECTION = 'agents';

export const agentSchema = z.object({
  key: z.string().cuid2(),
  slug: z.string(),
  name: z.string(),
  title: z.string(),
  scopeKey: z.string().cuid2(),
  embedding: z.array(z.number()).default([]),
});

export type Agent = z.infer<typeof agentSchema>;
export type AgentInsert = Omit<z.input<typeof agentSchema>, 'key' | 'embedding'> & { key?: string };

export const agentsEmbedKeys = z.enum(['name', 'title']);

const helpers = createNodeHelpers(AGENTS_COLLECTION, agentSchema, agentsEmbedKeys.options);

export function insertAgent(input: AgentInsert) {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getAgentById = helpers.getById;
export const updateAgent = helpers.updateById;
export const deleteAgent = helpers.deleteById;
export const upsertAgentByKey = helpers.upsertByKey;
export const getAllAgentsChunked = helpers.getAllChunked;
export const listAgentsPage = helpers.listPage;
