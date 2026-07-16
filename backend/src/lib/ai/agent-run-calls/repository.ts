import { aql } from 'arangojs';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_RUN_CALLS_COLLECTION, agentRunCallSchema } from './schema';
import type { AgentRunCallRepository } from './types';

export function createAgentRunCallRepository(database = db): AgentRunCallRepository {
  return {
    async insertCall(input) {
      const call = agentRunCallSchema.parse({ ...input, key: input.key ?? newId() });
      const result = await database.collection(AGENT_RUN_CALLS_COLLECTION).save(toArangoDoc(call), { returnNew: true });
      return agentRunCallSchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async listCallsForRun(agentRunKey) {
      const validKey = agentRunCallSchema.innerType().shape.agentRunKey.parse(agentRunKey);
      const cursor = await database.query(aql`
        FOR call IN ${database.collection(AGENT_RUN_CALLS_COLLECTION)}
          FILTER call.agentRunKey == ${validKey}
          SORT call.startedAt ASC, call._key ASC
          RETURN call
      `);
      return (await cursor.all()).map((doc) => agentRunCallSchema.parse(withArangoKey(doc)));
    },
  };
}

let cached: AgentRunCallRepository | null = null;
export function getDefaultAgentRunCallRepository() { return cached ??= createAgentRunCallRepository(); }
