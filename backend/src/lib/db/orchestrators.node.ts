import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const ORCHESTRATORS_COLLECTION = 'orchestrators';

export const orchestratorSchema = z.object({
  key: z.string(),
  name: z.string(),
  role: z.string(),
  voiceId: z.string(),
  skill: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Orchestrator = z.infer<typeof orchestratorSchema>;

// voiceId is an opaque foreign key into voices; skill is unbounded free text
// (a longer capability writeup), neither is search text.
export const orchestratorsEmbedKeys = z.enum(['name', 'role']);

const helpers = createNodeHelpers(ORCHESTRATORS_COLLECTION, orchestratorSchema, orchestratorsEmbedKeys.options);

export const insertOrchestrator = helpers.insert;
export const getOrchestratorById = helpers.getById;
export const updateOrchestrator = helpers.updateById;
export const deleteOrchestrator = helpers.deleteById;
export const upsertOrchestratorByKey = helpers.upsertByKey;
export const getAllOrchestratorsChunked = helpers.getAllChunked;
export const listOrchestratorsPage = helpers.listPage;

export async function getOrchestratorByName(name: string): Promise<Orchestrator | null> {
  const cursor = await db.query(aql`
    FOR o IN ${db.collection(ORCHESTRATORS_COLLECTION)}
      FILTER o.name == ${name}
      LIMIT 1
      RETURN o
  `);
  const doc = await cursor.next();
  return doc ? orchestratorSchema.parse(withArangoKey(doc)) : null;
}
