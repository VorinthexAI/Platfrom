import { aql } from 'arangojs';
import type { z } from 'zod';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AGENT_ARTIFACT_CHECKS_COLLECTION, agentArtifactCheckSchema, type AgentArtifactCheck } from './schema';

export type AgentArtifactCheckInsert = Omit<z.input<typeof agentArtifactCheckSchema>, 'key' | 'createdAt'> & { key?: string; createdAt?: string };
export interface AgentArtifactCheckRepository {
  insertCheck(input: AgentArtifactCheckInsert): Promise<AgentArtifactCheck>;
  listChecksForRun(agentRunKey: string): Promise<readonly AgentArtifactCheck[]>;
}
export function createAgentArtifactCheckRepository(database = db): AgentArtifactCheckRepository {
  return {
    async insertCheck(input) {
      const check = agentArtifactCheckSchema.parse({ ...input, key: input.key ?? newId(), createdAt: input.createdAt ?? new Date().toISOString() });
      const result = await database.collection(AGENT_ARTIFACT_CHECKS_COLLECTION).save(toArangoDoc(check), { returnNew: true });
      return agentArtifactCheckSchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async listChecksForRun(agentRunKey) {
      const key = agentArtifactCheckSchema.shape.agentRunKey.parse(agentRunKey);
      const cursor = await database.query(aql`FOR check IN ${database.collection(AGENT_ARTIFACT_CHECKS_COLLECTION)} FILTER check.agentRunKey == ${key} SORT check.createdAt ASC, check._key ASC RETURN check`);
      return (await cursor.all()).map((doc) => agentArtifactCheckSchema.parse(withArangoKey(doc)));
    },
  };
}
let cached: AgentArtifactCheckRepository | null = null;
export function getDefaultAgentArtifactCheckRepository() { return cached ??= createAgentArtifactCheckRepository(); }
