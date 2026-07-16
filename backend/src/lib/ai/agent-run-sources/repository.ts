import { aql } from 'arangojs';
import type { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AiError } from '@/lib/ai/shared/result';
import { AGENT_RUN_SOURCES_COLLECTION, agentRunSourceSchema, type AgentRunSource } from './schema';

export type AgentRunSourceInsert = Omit<z.input<typeof agentRunSourceSchema>, 'key'> & { key?: string };
export class DuplicateAgentRunSourceError extends AiError {
  constructor(runKey: string, nodeType: string, nodeKey: string) {
    super('duplicate_agent_run_source', `${nodeType}/${nodeKey} is already a source for run ${runKey}`);
  }
}
export interface AgentRunSourceRepository {
  insertSource(input: AgentRunSourceInsert): Promise<AgentRunSource>;
  listSourcesForRun(agentRunKey: string): Promise<readonly AgentRunSource[]>;
}
export function createAgentRunSourceRepository(database = db): AgentRunSourceRepository {
  return {
    async insertSource(input) {
      const source = agentRunSourceSchema.parse({ ...input, key: input.key ?? newId() });
      try {
        const result = await database.collection(AGENT_RUN_SOURCES_COLLECTION).save(toArangoDoc(source), { returnNew: true });
        return agentRunSourceSchema.parse(withArangoKey(result.new as Record<string, unknown>));
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateAgentRunSourceError(source.agentRunKey, source.nodeType, source.nodeKey);
        throw error;
      }
    },
    async listSourcesForRun(agentRunKey) {
      const key = agentRunSourceSchema.shape.agentRunKey.parse(agentRunKey);
      const cursor = await database.query(aql`FOR source IN ${database.collection(AGENT_RUN_SOURCES_COLLECTION)} FILTER source.agentRunKey == ${key} SORT source.priority DESC, source._key ASC RETURN source`);
      return (await cursor.all()).map((doc) => agentRunSourceSchema.parse(withArangoKey(doc)));
    },
  };
}
let cached: AgentRunSourceRepository | null = null;
export function getDefaultAgentRunSourceRepository() { return cached ??= createAgentRunSourceRepository(); }
