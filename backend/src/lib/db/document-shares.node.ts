import { z } from 'zod';
import { aql } from 'arangojs';
import { withArangoKey } from './base';
import { db } from './client';

export const DOCUMENT_SHARES_COLLECTION = 'documentShares';
export const documentSharePermissionSchema = z.enum(['read', 'comment']);

export const documentShareSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  permission: documentSharePermissionSchema,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 token hash.'),
  passwordHash: z.string().trim().min(20).optional(),
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DocumentShare = z.infer<typeof documentShareSchema>;
export const documentSharesEmbeddingFields = [] as const;
export async function insertDocumentShare(share: DocumentShare): Promise<DocumentShare> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.insertShare(share);
}
export async function getDocumentShareById(shareKey: string): Promise<DocumentShare | null> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.getShare(shareKey);
}
export async function updateDocumentShare(shareKey: string, patch: Partial<Pick<DocumentShare, 'revokedAt' | 'updatedAt'>>): Promise<DocumentShare> {
  const current = await getDocumentShareById(shareKey);
  if (!current) throw new Error(`Document share ${shareKey} was not found.`);
  const { contentPersistence } = await import('./content-persistence.node');
  const updated = await contentPersistence.updateShare(current.scopeKey, shareKey, patch);
  if (!updated) throw new Error(`Document share ${shareKey} is pending deletion.`);
  return updated;
}

export async function deleteDocumentShareInScope(scopeKey: string, shareKey: string): Promise<boolean> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.deleteShare(scopeKey, shareKey);
}

export async function deleteDocumentShare(shareKey: string): Promise<void> {
  const current = await getDocumentShareById(shareKey);
  if (!current || !await deleteDocumentShareInScope(current.scopeKey, shareKey)) throw new Error(`Document share ${shareKey} was not found.`);
}

export async function getActiveDocumentShareByTokenHash(tokenHash: string, at = new Date().toISOString()): Promise<DocumentShare | null> {
  const validatedTokenHash = documentShareSchema.shape.tokenHash.parse(tokenHash);
  const validatedAt = z.string().datetime().parse(at);
  if (await db.collection('shares').exists()) {
    const cursor = await db.query(aql`
      FOR share IN ${db.collection('shares')}
        FILTER share.sourceType == "document" && share.tokenHash == ${validatedTokenHash}
        FILTER share.revokedAt == null
        FILTER share.expiresAt == null || share.expiresAt > ${validatedAt}
        LET document = DOCUMENT(${db.collection('documents')}, share.sourceKey)
        FILTER document != null && document.scopeKey == share.scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        LET folder = document.folderKey == null ? null : DOCUMENT(${db.collection('folders')}, document.folderKey)
        FILTER folder == null || (folder.scopeKey == share.scopeKey && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null))
        LIMIT 1 RETURN share
    `);
    const share = await cursor.next();
    if (share) {
      const { sourceType: _sourceType, sourceKey: documentKey, ...projected } = (await import('./shares.node')).shareSchema.parse(withArangoKey(share));
      return documentShareSchema.parse({ ...projected, documentKey });
    }
    const marker = await db.collection('shares').document('content-document-shares-cutover').catch(() => null) as { state?: string } | null;
    if (marker?.state === 'global' || !await db.collection(DOCUMENT_SHARES_COLLECTION).exists()) return null;
  }
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share.tokenHash == ${validatedTokenHash}
      FILTER (!HAS(share, "revokedAt") || share.revokedAt == null)
      FILTER (!HAS(share, "expiresAt") || share.expiresAt == null || share.expiresAt > ${validatedAt})
      LET document = DOCUMENT(${db.collection('documents')}, share.documentKey)
      FILTER document != null && document.scopeKey == share.scopeKey
      FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
      LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(${db.collection('folders')}, document.folderKey) : null
      FILTER folder == null || folder.scopeKey == share.scopeKey
      FILTER folder == null || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      LIMIT 1
      RETURN share
  `);
  const share = await cursor.next();
  return share ? documentShareSchema.parse(withArangoKey(share)) : null;
}

export async function listDocumentShares(scopeKey: string, documentKey: string, includeRevoked = false): Promise<DocumentShare[]> {
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share.scopeKey == ${scopeKey} && share.documentKey == ${documentKey}
      FILTER ${includeRevoked} || !HAS(share, "revokedAt") || share.revokedAt == null
      SORT share.createdAt DESC
      RETURN share
  `);
  return (await cursor.all()).map((share) => documentShareSchema.parse(withArangoKey(share)));
}

export async function getDocumentShareInScope(scopeKey: string, shareKey: string): Promise<DocumentShare | null> {
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share._key == ${shareKey} && share.scopeKey == ${scopeKey}
      LIMIT 1
      RETURN share
  `);
  const share = await cursor.next();
  return share ? documentShareSchema.parse(withArangoKey(share)) : null;
}

export async function listDocumentSharesByKeysInScope(scopeKey: string, shareKeys: string[]): Promise<DocumentShare[]> {
  if (shareKeys.length === 0) return [];
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share.scopeKey == ${scopeKey} && share._key IN ${shareKeys}
      SORT POSITION(${shareKeys}, share._key) ASC
      RETURN share
  `);
  return (await cursor.all()).map((share) => documentShareSchema.parse(withArangoKey(share)));
}

export async function listDocumentSharesByDocumentKeys(
  scopeKey: string,
  documentKeys: string[],
  options: { includeExpired?: boolean; includeRevoked?: boolean; at?: string } = {},
): Promise<DocumentShare[]> {
  if (documentKeys.length === 0) return [];
  const at = options.at ?? new Date().toISOString();
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share.scopeKey == ${scopeKey} && share.documentKey IN ${documentKeys}
      FILTER ${options.includeRevoked ?? false} || !HAS(share, "revokedAt") || share.revokedAt == null
      FILTER ${options.includeExpired ?? false} || !HAS(share, "expiresAt") || share.expiresAt == null || share.expiresAt > ${at}
      SORT POSITION(${documentKeys}, share.documentKey) ASC, share.createdAt DESC
      RETURN share
  `);
  return (await cursor.all()).map((share) => documentShareSchema.parse(withArangoKey(share)));
}

export async function revokeDocumentShare(scopeKey: string, shareKey: string, revokedAt = new Date().toISOString()): Promise<DocumentShare | null> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.updateShare(scopeKey, shareKey, { revokedAt, updatedAt: revokedAt });
}
