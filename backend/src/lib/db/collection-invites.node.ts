import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const COLLECTION_INVITES_COLLECTION = 'collectionInvites';
export const collectionInviteSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), collectionKey: z.string().cuid(), invitedByKey: z.string().cuid(), inviteeKey: z.string().cuid().optional(),
  email: z.string().trim().toLowerCase().email().optional(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime().optional(), acceptedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine((invite, context) => {
  if ((invite.inviteeKey === undefined) === (invite.email === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of inviteeKey or email is required.' });
});
export type CollectionInvite = z.infer<typeof collectionInviteSchema>;
export const collectionInvitesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(COLLECTION_INVITES_COLLECTION, collectionInviteSchema, collectionInvitesEmbeddingFields, { requireEmbedding: false });
export const insertCollectionInvite = helpers.insert;
export const getCollectionInviteById = helpers.getById;
export const updateCollectionInvite = helpers.updateById;
export const deleteCollectionInvite = helpers.deleteById;
export const upsertCollectionInviteByKey = helpers.upsertByKey;
export const getAllCollectionInvitesChunked = helpers.getAllChunked;
export const listCollectionInvitesPage = helpers.listPage;
export async function listCollectionInvitesByScope(scopeKey: string, collectionKey?: string): Promise<CollectionInvite[]> {
  const cursor = await db.query(aql`FOR invite IN ${db.collection(COLLECTION_INVITES_COLLECTION)} FILTER invite.scopeKey == ${scopeKey} FILTER ${collectionKey ?? null} == null || invite.collectionKey == ${collectionKey ?? null} SORT invite.createdAt DESC, invite._key ASC RETURN invite`);
  return (await cursor.all()).map((invite) => collectionInviteSchema.parse(withArangoKey(invite)));
}
