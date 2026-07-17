import { aql } from 'arangojs';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { scopeMemberRoleSchema } from '@/lib/ai/scopes/schema';
import { createEdgeHelpers, withArangoKey } from './base';
import { db } from './client';

export const SCOPE_AGENTS_COLLECTION = 'scopeAgents';

export const scopeAgentSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  /**
   * The minimum effective scope role that inherits access to this agent.
   * Derived from the creator's effective role at creation; pre-existing rows
   * default to owner (the conservative reading) until migration backfills a
   * deliberate value. Changing it must run the inherited-grant synchronizer.
   */
  minimumAccessRole: scopeMemberRoleSchema.default('owner'),
  /** Organization membership of the human creator; null for system-seeded agents. */
  createdByUserOrganizationKey: z.string().cuid().nullable().default(null),
  createdAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
}).strict();

export type ScopeAgent = z.infer<typeof scopeAgentSchema>;
export type ScopeAgentInsert = Omit<z.input<typeof scopeAgentSchema>, 'key'> & { key?: string };

const helpers = createEdgeHelpers(SCOPE_AGENTS_COLLECTION, scopeAgentSchema);

export function insertScopeAgent(input: ScopeAgentInsert): Promise<ScopeAgent> {
  const now = new Date().toISOString();
  return helpers.insert({ createdAt: now, updatedAt: now, ...input, key: input.key ?? newId() });
}

export const getScopeAgentById = helpers.getById;

export async function getScopeAgentByAgentKey(agentKey: string): Promise<ScopeAgent | null> {
  const validAgentKey = scopeAgentSchema.shape.agentKey.parse(agentKey);
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(SCOPE_AGENTS_COLLECTION)}
      FILTER link.agentKey == ${validAgentKey}
      LIMIT 1
      RETURN link
  `);
  const document = await cursor.next();
  return document ? scopeAgentSchema.parse(withArangoKey(document)) : null;
}

export async function getScopeAgentByPair(scopeKey: string, agentKey: string): Promise<ScopeAgent | null> {
  const valid = scopeAgentSchema.pick({ scopeKey: true, agentKey: true }).parse({ scopeKey, agentKey });
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(SCOPE_AGENTS_COLLECTION)}
      FILTER link.scopeKey == ${valid.scopeKey} && link.agentKey == ${valid.agentKey}
      LIMIT 1
      RETURN link
  `);
  const document = await cursor.next();
  return document ? scopeAgentSchema.parse(withArangoKey(document)) : null;
}

export async function listScopeAgentsByScope(scopeKey: string): Promise<ScopeAgent[]> {
  const validScopeKey = scopeAgentSchema.shape.scopeKey.parse(scopeKey);
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(SCOPE_AGENTS_COLLECTION)}
      FILTER link.scopeKey == ${validScopeKey}
      SORT link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return (docs as Record<string, unknown>[]).map((doc) => scopeAgentSchema.parse(withArangoKey(doc)));
}

export const deleteScopeAgent = helpers.deleteById;
export const updateScopeAgent = helpers.updateById;
export const upsertScopeAgentByKey = helpers.upsertByKey;
export const getAllScopeAgentsChunked = helpers.getAllChunked;
export const listScopeAgentsPage = helpers.listPage;
