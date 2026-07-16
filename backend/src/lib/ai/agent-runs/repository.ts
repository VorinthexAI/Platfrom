import { db } from '@/lib/db/client';
import { z } from 'zod';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_RUNS_COLLECTION, agentRunSchema, type AgentRun } from './schema';
import { AgentRunNotFoundError, type AgentRunRepository, type AgentRunsDatabase } from './types';

export function createAgentRunRepository(database: AgentRunsDatabase = db): AgentRunRepository {
  return {
    async insertRun(input) {
      const run = agentRunSchema.parse({ ...input, key: newId(), createdAt: new Date().toISOString() });
      const result = await database.collection(AGENT_RUNS_COLLECTION).save(toArangoDoc(run), { returnNew: true });
      const saved = (result as { new?: Record<string, unknown> }).new;
      return (saved ? agentRunSchema.parse(withArangoKey(saved)) : run) satisfies AgentRun;
    },

    async getRunById(key) {
      const validKey = agentRunSchema.shape.key.parse(key);
      try {
        const doc = await database.collection(AGENT_RUNS_COLLECTION).document(validKey);
        return agentRunSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },

    async updateRun(key, input) {
      const validKey = agentRunSchema.shape.key.parse(key);
      const patch = agentRunSchema.pick({ status: true, reason: true, score: true, endedAt: true, elapsedMs: true }).parse(input);
      try {
        const result = await database.collection(AGENT_RUNS_COLLECTION).update(validKey, patch, { returnNew: true });
        return agentRunSchema.parse(withArangoKey((result as { new: Record<string, unknown> }).new));
      } catch (error) {
        if (isArangoNotFoundError(error)) throw new AgentRunNotFoundError(validKey);
        throw error;
      }
    },

    async listRunsForOrganization(organizationKey, limit = 50) {
      const validOrganizationKey = agentRunSchema.shape.organizationKey.parse(organizationKey);
      const validLimit = z.number().int().min(1).max(500).parse(limit);
      const cursor = await database.query(
        `
          FOR run IN @@collection
            FILTER run.organizationKey == @organizationKey
            SORT run.createdAt DESC
            LIMIT @limit
            RETURN run
        `,
        { '@collection': AGENT_RUNS_COLLECTION, organizationKey: validOrganizationKey, limit: validLimit },
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
