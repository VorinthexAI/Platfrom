import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const SHARES_COLLECTION = 'shares';
export const shareSourceTypeSchema = z.enum(['document', 'image', 'collection', 'place', 'book']);
export const sharePermissionSchema = z.enum(['read', 'comment', 'viewer', 'collaborator']);
export const shareSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), sourceType: shareSourceTypeSchema, sourceKey: z.string().cuid(), permission: sharePermissionSchema,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), passwordHash: z.string().trim().min(20).optional(), expiresAt: z.string().datetime().optional(), revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Share = z.infer<typeof shareSchema>;
export const replayableShareSchema = shareSchema.extend({ responseCiphertext: z.string().regex(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/) });
export type ReplayableShare = z.infer<typeof replayableShareSchema>;
export const sharesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(SHARES_COLLECTION, shareSchema, sharesEmbeddingFields, { requireEmbedding: false });
export const insertShare = helpers.insert;
export const getShareById = helpers.getById;
export const updateShare = helpers.updateById;
export const upsertShareByKey = helpers.upsertByKey;
export const getAllSharesChunked = helpers.getAllChunked;
export const listSharesPage = helpers.listPage;
export async function listSharesByScope(scopeKey: string, sourceType?: z.infer<typeof shareSourceTypeSchema>, sourceKey?: string): Promise<Share[]> {
  const cursor = await db.query(aql`FOR share IN ${db.collection(SHARES_COLLECTION)} FILTER share.scopeKey == ${scopeKey} FILTER ${sourceType ?? null} == null || share.sourceType == ${sourceType ?? null} FILTER ${sourceKey ?? null} == null || share.sourceKey == ${sourceKey ?? null} SORT share.createdAt DESC, share._key ASC RETURN share`);
  return (await cursor.all()).map((share) => shareSchema.parse(withArangoKey(share)));
}

export async function getActiveShareByTokenHash(tokenHash: string, at = new Date().toISOString()): Promise<Share | null> {
  const validatedHash = shareSchema.shape.tokenHash.parse(tokenHash);
  const validatedAt = z.string().datetime().parse(at);
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(SHARES_COLLECTION)}
      FILTER share.tokenHash == ${validatedHash}
      FILTER (!HAS(share, "revokedAt") || share.revokedAt == null)
      FILTER (!HAS(share, "expiresAt") || share.expiresAt == null || share.expiresAt > ${validatedAt})
      LET scope = DOCUMENT(${db.collection('scopes')}, share.scopeKey)
      LET source = share.sourceType == "document" ? DOCUMENT(${db.collection('documents')}, share.sourceKey)
        : share.sourceType == "image" ? DOCUMENT(${db.collection('images')}, share.sourceKey)
        : share.sourceType == "collection" ? DOCUMENT(${db.collection('collections')}, share.sourceKey)
        : share.sourceType == "book" ? DOCUMENT(${db.collection('books')}, share.sourceKey)
        : DOCUMENT(${db.collection('places')}, share.sourceKey)
      FILTER scope != null
      FILTER source != null && source.scopeKey == share.scopeKey
      LIMIT 1
      RETURN share
  `);
  const share = await cursor.next();
  return share ? shareSchema.parse(withArangoKey(share)) : null;
}
