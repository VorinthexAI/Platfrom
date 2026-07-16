import { aql } from 'arangojs';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_RUN_STEPS_COLLECTION, agentRunStepSchema } from './schema';
import type { AgentRunStepRepository } from './types';

export function createAgentRunStepRepository(database = db): AgentRunStepRepository {
  return {
    async insertStep(input) {
      const step = agentRunStepSchema.parse({ ...input, key: input.key ?? newId() });
      const result = await database.collection(AGENT_RUN_STEPS_COLLECTION).save(toArangoDoc(step), { returnNew: true });
      return agentRunStepSchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async listStepsForRun(agentRunKey) {
      const validKey = zCuid(agentRunKey);
      const cursor = await database.query(aql`
        FOR step IN ${database.collection(AGENT_RUN_STEPS_COLLECTION)}
          FILTER step.agentRunKey == ${validKey}
          SORT step.startedAt ASC, step._key ASC
          RETURN step
      `);
      return (await cursor.all()).map((doc) => agentRunStepSchema.parse(withArangoKey(doc)));
    },
  };
}

function zCuid(value: string) { return agentRunStepSchema.shape.agentRunKey.parse(value); }
let cached: AgentRunStepRepository | null = null;
export function getDefaultAgentRunStepRepository() { return cached ??= createAgentRunStepRepository(); }
