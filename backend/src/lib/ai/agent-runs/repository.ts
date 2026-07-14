import { db } from '@/lib/db/client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_RUNS_COLLECTION, agentRunSchema, type AgentRun } from './schema';
import { AgentRunNotFoundError, type AgentRunRepository, type AgentRunsDatabase } from './types';

/**
 * Data access for the `agent_runs` execution ledger. Application code only
 * ever handles `key`; the `_key` rename happens exclusively through the
 * shared base.ts translators. Queries are parameterized.
 */
export function createAgentRunRepository(database: AgentRunsDatabase = db): AgentRunRepository {
  return {
    async insertRun(input) {
      const now = new Date().toISOString();
      const run = agentRunSchema.parse({ ...input, key: newId(), createdAt: now, updatedAt: now });
      const result = await database
        .collection(AGENT_RUNS_COLLECTION)
        .save(toArangoDoc({ ...run }), { returnNew: true });
      const saved = (result as { new?: Record<string, unknown> }).new;
      return (saved ? agentRunSchema.parse(withArangoKey(saved)) : run) satisfies AgentRun;
    },

    async updateRun(key, patch) {
      try {
        const result = await database
          .collection(AGENT_RUNS_COLLECTION)
          .update(key, { ...patch, updatedAt: new Date().toISOString() }, { returnNew: true, mergeObjects: false });
        const updated = (result as { new?: Record<string, unknown> }).new;
        if (!updated) throw new AgentRunNotFoundError(key);
        return agentRunSchema.parse(withArangoKey(updated));
      } catch (err) {
        if (isArangoNotFoundError(err)) throw new AgentRunNotFoundError(key);
        throw err;
      }
    },

    async getRunById(key) {
      try {
        const doc = await database.collection(AGENT_RUNS_COLLECTION).document(key);
        return agentRunSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (err) {
        if (isArangoNotFoundError(err)) return null;
        throw err;
      }
    },

    async listRunsForOrganization(organizationId, limit = 50) {
      const cursor = await database.query(
        `
          FOR run IN @@collection
            FILTER run.organizationId == @organizationId
            SORT run.createdAt DESC
            LIMIT @limit
            RETURN run
        `,
        { '@collection': AGENT_RUNS_COLLECTION, organizationId, limit },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => agentRunSchema.parse(withArangoKey(doc)));
    },
  };
}

let cachedDefaultRepository: AgentRunRepository | null = null;

/** Process-wide repository bound to the shared ArangoDB client. */
export function getDefaultAgentRunRepository(): AgentRunRepository {
  cachedDefaultRepository ??= createAgentRunRepository();
  return cachedDefaultRepository;
}
