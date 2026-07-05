import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const MIND_CAPABILITIES_COLLECTION = 'mindCapabilities';

export const mindCapabilitySchema = z.object({
  key: z.string(),
  mindId: z.string(),
  capabilityId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type MindCapability = z.infer<typeof mindCapabilitySchema>;

// Relationship records are resolved by ids and do not carry semantic text.
const helpers = createNodeHelpers(MIND_CAPABILITIES_COLLECTION, mindCapabilitySchema);

export const insertMindCapability = helpers.insert;
export const getMindCapabilityById = helpers.getById;
export const updateMindCapability = helpers.updateById;
export const deleteMindCapability = helpers.deleteById;
export const upsertMindCapabilityByKey = helpers.upsertByKey;
export const getAllMindCapabilitiesChunked = helpers.getAllChunked;
export const listMindCapabilitiesPage = helpers.listPage;

export async function getMindCapabilityByPair(
  mindId: string,
  capabilityId: string,
): Promise<MindCapability | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MIND_CAPABILITIES_COLLECTION)}
      FILTER link.mindId == ${mindId} && link.capabilityId == ${capabilityId}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? mindCapabilitySchema.parse(withArangoKey(doc)) : null;
}

export async function listMindCapabilitiesByMindId(mindId: string): Promise<MindCapability[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MIND_CAPABILITIES_COLLECTION)}
      FILTER link.mindId == ${mindId}
      SORT link.createdAt ASC, link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => mindCapabilitySchema.parse(withArangoKey(doc)));
}

export async function listMindCapabilitiesByCapabilityId(capabilityId: string): Promise<MindCapability[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MIND_CAPABILITIES_COLLECTION)}
      FILTER link.capabilityId == ${capabilityId}
      SORT link.createdAt ASC, link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => mindCapabilitySchema.parse(withArangoKey(doc)));
}
