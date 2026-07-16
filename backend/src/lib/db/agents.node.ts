import { z } from 'zod';
import { aql } from 'arangojs';
import { newId } from '@/lib/ids';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const AGENTS_COLLECTION = 'agents';

export const agentSchema = z.object({
  key: z.string().cuid(),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Agent slug must use lowercase kebab-case'),
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  explorationRate: z.number().min(0).max(1).default(0.5),
  embedding: z.array(z.number().finite()).default([]),
});

export type Agent = z.infer<typeof agentSchema>;
export type AgentInsert = Omit<z.input<typeof agentSchema>, 'key' | 'embedding'> & { key?: string };

export const agentsEmbedKeys = z.enum(['name', 'title']);

const helpers = createNodeHelpers(AGENTS_COLLECTION, agentSchema, agentsEmbedKeys.options);

export function insertAgent(input: AgentInsert) {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getAgentById = helpers.getById;

export async function getAgentBySlug(slug: string): Promise<Agent | null> {
  const validSlug = agentSchema.shape.slug.parse(slug);
  const cursor = await db.query(aql`
    FOR agent IN ${db.collection(AGENTS_COLLECTION)}
      FILTER agent.slug == ${validSlug}
      LIMIT 1
      RETURN agent
  `);
  const document = await cursor.next();
  return document ? agentSchema.parse(withArangoKey(document)) : null;
}
export const updateAgent = helpers.updateById;
export const deleteAgent = helpers.deleteById;
export const upsertAgentByKey = helpers.upsertByKey;
export const getAllAgentsChunked = helpers.getAllChunked;
export const listAgentsPage = helpers.listPage;
