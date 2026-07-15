import { db } from '@/lib/db/client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_RUNS_COLLECTION, agentRunSchema, type AgentRun } from './schema';
import type { AgentRunRepository, AgentRunsDatabase } from './types';

export function createAgentRunRepository(database: AgentRunsDatabase = db): AgentRunRepository {
  return {
    async insertRun(input) {
      const run = agentRunSchema.parse({ ...input, key: newId(), createdAt: new Date().toISOString() });
      const result = await database.collection(AGENT_RUNS_COLLECTION).save(toArangoDoc(run), { returnNew: true });
      const saved = (result as { new?: Record<string, unknown> }).new;
      return (saved ? agentRunSchema.parse(withArangoKey(saved)) : run) satisfies AgentRun;
    },

    async getRunById(key) {
      try {
        const doc = await database.collection(AGENT_RUNS_COLLECTION).document(key);
        return agentRunSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },

    async listRunsForOrganization(organizationKey, limit = 50) {
      const cursor = await database.query(
        `
          FOR run IN @@collection
            FILTER run.organizationKey == @organizationKey
            SORT run.createdAt DESC
            LIMIT @limit
            RETURN run
        `,
        { '@collection': AGENT_RUNS_COLLECTION, organizationKey, limit },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => agentRunSchema.parse(withArangoKey(doc)));
    },
  };
}

let cachedDefaultRepository: AgentRunRepository | null = null;

export function getDefaultAgentRunRepository(): AgentRunRepository {
  cachedDefaultRepository ??= createAgentRunRepository();
  return cachedDefaultRepository;
}
