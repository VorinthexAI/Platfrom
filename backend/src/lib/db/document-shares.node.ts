import { z } from 'zod';
import { aql } from 'arangojs';
import { createNodeHelpers, withArangoKey } from './base';
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
  embedding: z.array(z.number().finite()).length(0).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DocumentShare = z.infer<typeof documentShareSchema>;
export const documentSharesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(DOCUMENT_SHARES_COLLECTION, documentShareSchema, documentSharesEmbeddingFields);
export async function insertDocumentShare(share: Omit<DocumentShare, 'embedding' | 'deletedAt'>): Promise<DocumentShare> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.insertShare(share);
}
export const getDocumentShareById = helpers.getById;
export async function updateDocumentShare(shareKey: string, patch: Partial<Pick<DocumentShare, 'revokedAt' | 'deletedAt' | 'updatedAt'>>): Promise<DocumentShare> {
  const current = await helpers.getById(shareKey);
  if (!current) throw new Error(`Document share ${shareKey} was not found.`);
  const { archivePersistence } = await import('./archive-persistence.node');
  const updated = await archivePersistence.updateShare(current.scopeKey, shareKey, patch);
  if (!updated) throw new Error(`Document share ${shareKey} is pending deletion.`);
  return updated;
}
export const upsertDocumentShareByKey = helpers.upsertByKey;
export const getAllDocumentSharesChunked = helpers.getAllChunked;
export const listDocumentSharesPage = helpers.listPage;

export async function deleteDocumentShareInScope(scopeKey: string, shareKey: string): Promise<boolean> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.deleteShare(scopeKey, shareKey);
}

export async function deleteDocumentShare(shareKey: string): Promise<void> {
  const current = await helpers.getById(shareKey);
  if (!current || !await deleteDocumentShareInScope(current.scopeKey, shareKey)) throw new Error(`Document share ${shareKey} was not found.`);
}

export async function getActiveDocumentShareByTokenHash(tokenHash: string, at = new Date().toISOString()): Promise<DocumentShare | null> {
  const validatedTokenHash = documentShareSchema.shape.tokenHash.parse(tokenHash);
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share.tokenHash == ${validatedTokenHash}
      FILTER share.deletedAt == null
      FILTER (!HAS(share, "revokedAt") || share.revokedAt == null)
      FILTER (!HAS(share, "expiresAt") || share.expiresAt == null || share.expiresAt > ${at})
      LET document = DOCUMENT(${db.collection('documents')}, share.documentKey)
      FILTER document != null && document.scopeKey == share.scopeKey
      FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
      FILTER document.deletedAt == null
      LET folder = DOCUMENT(${db.collection('folders')}, document.folderKey)
      FILTER folder != null && folder.scopeKey == share.scopeKey
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER folder.deletedAt == null
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
      FILTER share.deletedAt == null
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
      FILTER share.deletedAt == null
      FILTER ${options.includeRevoked ?? false} || !HAS(share, "revokedAt") || share.revokedAt == null
      FILTER ${options.includeExpired ?? false} || !HAS(share, "expiresAt") || share.expiresAt == null || share.expiresAt > ${at}
      SORT POSITION(${documentKeys}, share.documentKey) ASC, share.createdAt DESC
      RETURN share
  `);
  return (await cursor.all()).map((share) => documentShareSchema.parse(withArangoKey(share)));
}

export async function revokeDocumentShare(scopeKey: string, shareKey: string, revokedAt = new Date().toISOString()): Promise<DocumentShare | null> {
  const cursor = await db.query(aql`
    FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      FILTER share._key == ${shareKey} && share.scopeKey == ${scopeKey}
      LIMIT 1
      UPDATE share WITH { revokedAt: ${revokedAt}, updatedAt: ${revokedAt} }
        IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}
      RETURN NEW
  `);
  const share = await cursor.next();
  return share ? documentShareSchema.parse(withArangoKey(share)) : null;
}

export async function archiveDocumentShare(key: string): Promise<DocumentShare> {
  const timestamp = new Date().toISOString();
  return updateDocumentShare(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreDocumentShare(key: string): Promise<DocumentShare> {
  const timestamp = new Date().toISOString();
  return updateDocumentShare(key, { deletedAt: null, updatedAt: timestamp });
}
