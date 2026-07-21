import { aql } from 'arangojs';
import type { z } from 'zod';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { embedText } from '@/lib/bedrock-titan';
import { newId } from '@/lib/ids';
import { AGENT_MEMORIES_COLLECTION, agentMemorySchema, type AgentMemory } from './schema';

export type AgentMemoryInsert = Omit<z.input<typeof agentMemorySchema>, 'key' | 'embedding' | 'createdAt'> & { key?: string };
export interface AgentMemoryRepository {
  insertMemory(input: AgentMemoryInsert): Promise<AgentMemory>;
  listMemoriesForAgent(agentKey: string): Promise<readonly AgentMemory[]>;
}
export function createAgentMemoryRepository(database = db): AgentMemoryRepository {
  return {
    async insertMemory(input) {
      const key = input.key ?? newId();
      const parsed = agentMemorySchema.parse({ ...input, key, embedding: [], createdAt: new Date().toISOString() });
      const memory = { ...parsed, embedding: await embedText({ text: parsed.content }) };
      const result = await database.collection(AGENT_MEMORIES_COLLECTION).save(toArangoDoc(memory), { returnNew: true });
      return agentMemorySchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async listMemoriesForAgent(agentKey) {
      const validKey = agentMemorySchema.shape.agentKey.parse(agentKey);
      const cursor = await database.query(aql`
        FOR memory IN ${database.collection(AGENT_MEMORIES_COLLECTION)}
          FILTER memory.agentKey == ${validKey}
          SORT memory.importance DESC, memory.createdAt DESC, memory._key ASC
          RETURN memory
      `);
      return (await cursor.all()).map((doc) => agentMemorySchema.parse(withArangoKey(doc)));
    },
  };
}
let cached: AgentMemoryRepository | null = null;
export function getDefaultAgentMemoryRepository() { return cached ??= createAgentMemoryRepository(); }
