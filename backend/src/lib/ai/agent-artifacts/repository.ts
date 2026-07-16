import { aql } from 'arangojs';
import type { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { AiError } from '@/lib/ai/shared/result';
import { newId } from '@/lib/ids';
import { AGENT_ARTIFACTS_COLLECTION, agentArtifactSchema, type AgentArtifact } from './schema';

export type AgentArtifactInsert = Omit<z.input<typeof agentArtifactSchema>, 'key'> & { key?: string };

export class DuplicateAgentArtifactError extends AiError {
  constructor(agentRunKey: string, nodeType: string, nodeKey: string, relation: string) {
    super('duplicate_agent_artifact', `${nodeType}/${nodeKey} already has relation ${relation} to run ${agentRunKey}`);
  }
}

export interface AgentArtifactRepository {
  insertArtifact(input: AgentArtifactInsert): Promise<AgentArtifact>;
  listArtifactsForRun(agentRunKey: string): Promise<readonly AgentArtifact[]>;
}
export function createAgentArtifactRepository(database = db): AgentArtifactRepository {
  return {
    async insertArtifact(input) {
      const link = agentArtifactSchema.parse({ ...input, key: input.key ?? newId() });
      try {
        const result = await database.collection(AGENT_ARTIFACTS_COLLECTION).save(toArangoDoc(link), { returnNew: true });
        return agentArtifactSchema.parse(withArangoKey(result.new as Record<string, unknown>));
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateAgentArtifactError(link.agentRunKey, link.nodeType, link.nodeKey, link.relation);
        }
        throw error;
      }
    },
    async listArtifactsForRun(agentRunKey) {
      const validKey = agentArtifactSchema.shape.agentRunKey.parse(agentRunKey);
      const cursor = await database.query(aql`FOR link IN ${database.collection(AGENT_ARTIFACTS_COLLECTION)} FILTER link.agentRunKey == ${validKey} SORT link.groupKey ASC, link.position ASC, link._key ASC RETURN link`);
      return (await cursor.all()).map((doc) => agentArtifactSchema.parse(withArangoKey(doc)));
    },
  };
}
let cached: AgentArtifactRepository | null = null;
export function getDefaultAgentArtifactRepository() { return cached ??= createAgentArtifactRepository(); }
