import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const COLLECTION_MEMBERS_COLLECTION = 'collectionMembers';
export const collectionMemberRoleSchema = z.enum(['owner', 'member']);
export const collectionMemberSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), collectionKey: z.string().cuid(), memberKey: z.string().cuid(), role: collectionMemberRoleSchema.default('member'), createdAt: z.string().datetime() });
export type CollectionMember = z.infer<typeof collectionMemberSchema>;
export const collectionMembersEmbeddingFields = [] as const;
const helpers = createNodeHelpers(COLLECTION_MEMBERS_COLLECTION, collectionMemberSchema, collectionMembersEmbeddingFields, { requireEmbedding: false });
export const insertCollectionMember = helpers.insert;
export const getCollectionMemberById = helpers.getById;
export const updateCollectionMember = helpers.updateById;
export const deleteCollectionMember = helpers.deleteById;
export const upsertCollectionMemberByKey = helpers.upsertByKey;
export const getAllCollectionMembersChunked = helpers.getAllChunked;
export const listCollectionMembersPage = helpers.listPage;
export async function listCollectionMembersByScope(scopeKey: string, collectionKey?: string): Promise<CollectionMember[]> {
  const cursor = await db.query(aql`FOR member IN ${db.collection(COLLECTION_MEMBERS_COLLECTION)} FILTER member.scopeKey == ${scopeKey} FILTER ${collectionKey ?? null} == null || member.collectionKey == ${collectionKey ?? null} SORT member.createdAt ASC, member._key ASC RETURN member`);
  return (await cursor.all()).map((member) => collectionMemberSchema.parse(withArangoKey(member)));
}
