import { aql } from 'arangojs';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { createEdgeHelpers, isArangoUniqueConstraintError, withArangoKey } from './base';
import { db } from './client';

export const AGENT_MEMBERS_COLLECTION = 'agentMembers';

export const agentMemberSourceSchema = z.enum(['inherited', 'explicit']);
export type AgentMemberSource = z.infer<typeof agentMemberSourceSchema>;

/**
 * A binary access grant: one row means "this membership may use this agent".
 * There is deliberately no agent-level role here — organization and scope
 * roles define authority, `source` only records why the grant exists so
 * synchronization can retract inherited rows without touching explicit ones.
 */
export const agentMemberSchema = z.object({
  key: z.string().cuid(),
  agentKey: z.string().cuid(),
  userOrganizationKey: z.string().cuid(),
  source: agentMemberSourceSchema,
  /** The scopeAgents relationship the grant flows through. Always set in V1. */
  scopeAgentKey: z.string().cuid(),
  /** Null for inherited (system-generated) grants; the granting membership for explicit ones. */
  createdByUserOrganizationKey: z.string().cuid().nullable().default(null),
  createdAt: z.string().datetime(),
}).strict();

export type AgentMember = z.infer<typeof agentMemberSchema>;
export type AgentMemberInsert = Omit<z.input<typeof agentMemberSchema>, 'key' | 'createdAt'> & { key?: string; createdAt?: string };

const helpers = createEdgeHelpers(AGENT_MEMBERS_COLLECTION, agentMemberSchema);

export const getAgentMemberById = helpers.getById;
export const deleteAgentMember = helpers.deleteById;
export const upsertAgentMemberByKey = helpers.upsertByKey;
export const getAllAgentMembersChunked = helpers.getAllChunked;
export const listAgentMembersPage = helpers.listPage;

/**
 * Idempotent grant writer: the (agentKey, userOrganizationKey, source,
 * scopeAgentKey) unique index makes repeated synchronization and replayed
 * events converge on a single row instead of duplicating grants.
 */
export async function ensureAgentMemberGrant(input: AgentMemberInsert): Promise<AgentMember> {
  const existing = await findAgentMemberGrant(input.agentKey, input.userOrganizationKey, input.source, input.scopeAgentKey);
  if (existing) return existing;
  try {
    return await helpers.insert({ ...input, key: input.key ?? newId(), createdAt: input.createdAt ?? new Date().toISOString() });
  } catch (error) {
    if (isArangoUniqueConstraintError(error)) {
      const grant = await findAgentMemberGrant(input.agentKey, input.userOrganizationKey, input.source, input.scopeAgentKey);
      if (grant) return grant;
    }
    throw error;
  }
}

export async function findAgentMemberGrant(
  agentKey: string,
  userOrganizationKey: string,
  source: AgentMemberSource,
  scopeAgentKey: string,
): Promise<AgentMember | null> {
  const valid = agentMemberSchema.pick({ agentKey: true, userOrganizationKey: true, source: true, scopeAgentKey: true })
    .parse({ agentKey, userOrganizationKey, source, scopeAgentKey });
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.agentKey == ${valid.agentKey}
        && grant.userOrganizationKey == ${valid.userOrganizationKey}
        && grant.source == ${valid.source}
        && grant.scopeAgentKey == ${valid.scopeAgentKey}
      LIMIT 1
      RETURN grant
  `);
  const document = await cursor.next();
  return document ? agentMemberSchema.parse(withArangoKey(document as Record<string, unknown>)) : null;
}

/** Every grant a membership holds on one agent — the runtime access check. */
export async function listAgentMemberGrants(agentKey: string, userOrganizationKey: string): Promise<AgentMember[]> {
  const valid = agentMemberSchema.pick({ agentKey: true, userOrganizationKey: true }).parse({ agentKey, userOrganizationKey });
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.agentKey == ${valid.agentKey} && grant.userOrganizationKey == ${valid.userOrganizationKey}
      SORT grant.source ASC, grant._key ASC
      RETURN grant
  `);
  const docs = await cursor.all();
  return (docs as Record<string, unknown>[]).map((doc) => agentMemberSchema.parse(withArangoKey(doc)));
}

export async function listAgentMembersByAgent(agentKey: string): Promise<AgentMember[]> {
  const validAgentKey = agentMemberSchema.shape.agentKey.parse(agentKey);
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.agentKey == ${validAgentKey}
      SORT grant.userOrganizationKey ASC, grant.source ASC, grant._key ASC
      RETURN grant
  `);
  const docs = await cursor.all();
  return (docs as Record<string, unknown>[]).map((doc) => agentMemberSchema.parse(withArangoKey(doc)));
}

/** Every grant one organization membership holds — powers "agents accessible to me" listings. */
export async function listAgentMembersByMembership(userOrganizationKey: string): Promise<AgentMember[]> {
  const valid = agentMemberSchema.shape.userOrganizationKey.parse(userOrganizationKey);
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.userOrganizationKey == ${valid}
      SORT grant.agentKey ASC, grant.source ASC, grant._key ASC
      RETURN grant
  `);
  const docs = await cursor.all();
  return (docs as Record<string, unknown>[]).map((doc) => agentMemberSchema.parse(withArangoKey(doc)));
}

/** Inherited grants generated by one scopeAgents relationship — the synchronizer's working set. */
export async function listInheritedGrantsByScopeAgent(scopeAgentKey: string): Promise<AgentMember[]> {
  const validScopeAgentKey = agentMemberSchema.shape.scopeAgentKey.parse(scopeAgentKey);
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.scopeAgentKey == ${validScopeAgentKey} && grant.source == 'inherited'
      RETURN grant
  `);
  const docs = await cursor.all();
  return (docs as Record<string, unknown>[]).map((doc) => agentMemberSchema.parse(withArangoKey(doc)));
}

/** Removes already-absent grants without error so retried cleanup stays idempotent. */
export async function deleteAgentMemberGrants(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const validKeys = z.array(agentMemberSchema.shape.key).parse([...keys]);
  await db.query(aql`
    FOR key IN ${validKeys}
      REMOVE key IN ${db.collection(AGENT_MEMBERS_COLLECTION)} OPTIONS { ignoreErrors: true }
  `);
}

/** Removes every grant held by one organization membership (member removed from the organization). */
export async function deleteAgentMembersForMembership(userOrganizationKey: string): Promise<number> {
  const valid = agentMemberSchema.shape.userOrganizationKey.parse(userOrganizationKey);
  const cursor = await db.query(aql`
    FOR grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      FILTER grant.userOrganizationKey == ${valid}
      REMOVE grant IN ${db.collection(AGENT_MEMBERS_COLLECTION)}
      COLLECT WITH COUNT INTO removed
      RETURN removed
  `);
  const removed = await cursor.next();
  return typeof removed === 'number' ? removed : 0;
}

export interface AgentMembersSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}

export async function ensureAgentMembersCollection(database: AgentMembersSetupDatabase = db): Promise<void> {
  const collection = database.collection(AGENT_MEMBERS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'userOrganizationKey', 'source', 'scopeAgentKey'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'userOrganizationKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeAgentKey', 'source'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['userOrganizationKey', 'source'], unique: false });
}
