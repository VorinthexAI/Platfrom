import { documentSchema, type Document } from './documents.node';
import { folderSchema, type Folder } from './folders.node';
import { documentShareSchema, type DocumentShare } from './document-shares.node';
import { documentVersionSchema, type DocumentVersion } from './document-versions.node';
import { newId } from '@/lib/ids';
import { toArangoDoc, withArangoKey } from './base';
import { db, withTransaction } from './client';
import { canonicalDocumentRepresentations } from '@/lib/ai/document-processing/representation';

type QueryCursor = { next(): Promise<unknown>; all?(): Promise<unknown[]> };
export interface ArchiveQueryExecutor {
  query(query: string, bindVars?: Record<string, unknown>): Promise<QueryCursor>;
}

type MutableFolderField = 'parentFolderKey' | 'name' | 'description' | 'isFavorite' | 'deletedAt' | 'updatedAt' | 'embedding' | '_internalDeletion';
type MutableDocumentField = 'folderKey' | 'name' | 'html' | 'content' | 'isFavorite' | 'embedding' | 'speechStorageKeys' | 'deletedAt' | 'updatedAt' | '_internalDeletion';
export type ScopedFolderPatch = Partial<Pick<Folder, MutableFolderField>>;
export type ScopedDocumentPatch = Partial<Pick<Document, MutableDocumentField>>;

function canonicalRepresentations(html: string, content: string) {
  const canonical = canonicalDocumentRepresentations(html);
  if (html !== canonical.html || content !== canonical.content) throw new Error('Document representations must be canonical and agreeing.');
  return canonical;
}

function splitPatch(patch: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) unset.push(field);
    else set[field] = value;
  }
  return { set, unset };
}

async function scopedUpdate<T>(
  executor: ArchiveQueryExecutor,
  collection: 'folders' | 'documents' | 'documentShares',
  scopeKey: string,
  key: string,
  patch: Record<string, unknown>,
  parse: (value: Record<string, unknown>) => T,
): Promise<T | null> {
  const { set, unset } = splitPatch(patch);
  const ownership = collection === 'folders' ? `
      FILTER !HAS(current, "_internalDeletion") || current._internalDeletion == null
      LET destination = @destinationKey == null ? null : DOCUMENT(folders, @destinationKey)
      FILTER destination == null || (destination.scopeKey == @scopeKey && (!HAS(destination, "_internalDeletion") || destination._internalDeletion == null))
  ` : collection === 'documents' ? `
      FILTER !HAS(current, "_internalDeletion") || current._internalDeletion == null
      LET destinationKey = @changesLocation ? @destinationKey : (HAS(current, "folderKey") ? current.folderKey : null)
      LET destination = destinationKey == null ? null : DOCUMENT(folders, destinationKey)
      FILTER destinationKey == null || (destination != null && destination.scopeKey == @scopeKey)
      FILTER destinationKey == null || ((!HAS(destination, "_internalDeletion") || destination._internalDeletion == null) && destination.deletedAt == null)
  ` : `
      LET owner = DOCUMENT(documents, current.documentKey)
      FILTER owner != null && owner.scopeKey == @scopeKey
      FILTER !HAS(owner, "_internalDeletion") || owner._internalDeletion == null
  `;
  const cursor = await executor.query(`
    FOR current IN @@collection
      FILTER current._key == @key && current.scopeKey == @scopeKey
      ${ownership}
      LIMIT 1
      REPLACE current WITH UNSET(MERGE(current, @patch), APPEND(@unset, ["_id", "_rev"]))
        IN @@collection
      RETURN NEW
  `, {
    '@collection': collection,
    key,
    scopeKey,
    ...(collection === 'documentShares' ? {} : {
      destinationKey: set.parentFolderKey ?? set.folderKey ?? null,
      changesLocation: collection === 'folders'
        ? Object.prototype.hasOwnProperty.call(patch, 'parentFolderKey')
        : Object.prototype.hasOwnProperty.call(patch, 'folderKey'),
    }),
    patch: set,
    unset,
  });
  const value = await cursor.next();
  return value ? parse(withArangoKey(value as Record<string, unknown>)) : null;
}

async function scopedDelete(
  executor: ArchiveQueryExecutor,
  collection: 'folders' | 'documents' | 'documentVersions' | 'documentShares',
  scopeKey: string,
  key: string,
): Promise<boolean> {
  const cursor = await executor.query(`
    FOR current IN @@collection
      FILTER current._key == @key && current.scopeKey == @scopeKey
      LIMIT 1
      REMOVE current IN @@collection
      RETURN OLD._key
  `, { '@collection': collection, key, scopeKey });
  return (await cursor.next()) !== undefined;
}

/** Query-bound mutations can use either the global database or a streaming transaction executor. */
export function createArchivePersistence(executor: ArchiveQueryExecutor) {
  return {
    async getFolder(key: string): Promise<Folder | null> {
      const cursor = await executor.query('RETURN DOCUMENT(folders, @key)', { key });
      const value = await cursor.next();
      return value ? folderSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async listFolders(scopeKey: string, includeArchived = false, includePendingDeletion = false): Promise<Folder[]> {
      const cursor = await executor.query(`FOR folder IN folders FILTER folder.scopeKey == @scopeKey FILTER @includeArchived || folder.deletedAt == null FILTER @includePending || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null RETURN folder`, { scopeKey, includeArchived, includePending: includePendingDeletion });
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) => folderSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async getDocument(key: string): Promise<Document | null> {
      const cursor = await executor.query('RETURN DOCUMENT(documents, @key)', { key });
      const value = await cursor.next();
      return value ? documentSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async listDocuments(scopeKey: string, includeArchived = false, includePendingDeletion = false): Promise<Document[]> {
      const cursor = await executor.query(`FOR document IN documents FILTER document.scopeKey == @scopeKey FILTER @includeArchived || document.deletedAt == null FILTER @includePending || !HAS(document, "_internalDeletion") || document._internalDeletion == null RETURN document`, { scopeKey, includeArchived, includePending: includePendingDeletion });
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) => documentSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async getShare(key: string): Promise<DocumentShare | null> {
      const cursor = await executor.query('RETURN DOCUMENT(documentShares, @key)', { key });
      const value = await cursor.next();
      return value ? documentShareSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async listShares(scopeKey: string, documentKeys: string[]): Promise<DocumentShare[]> {
      if (documentKeys.length === 0) return [];
      const cursor = await executor.query('FOR share IN documentShares FILTER share.scopeKey == @scopeKey && share.documentKey IN @documentKeys RETURN share', { scopeKey, documentKeys });
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) => documentShareSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async getVersion(key: string): Promise<DocumentVersion | null> {
      const cursor = await executor.query('RETURN DOCUMENT(documentVersions, @key)', { key });
      const value = await cursor.next();
      return value ? documentVersionSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async listVersions(scopeKey: string, documentKeys: string[]): Promise<DocumentVersion[]> {
      if (documentKeys.length === 0) return [];
      const cursor = await executor.query('FOR snapshot IN documentVersions FILTER snapshot.scopeKey == @scopeKey && snapshot.documentKey IN @documentKeys SORT snapshot.version DESC RETURN snapshot', { scopeKey, documentKeys });
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) => documentVersionSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async insertFolder(folder: Folder): Promise<Folder> {
      const parsed = folderSchema.parse(folder);
      const cursor = await executor.query(
        `LET parent = @parentKey == null ? {} : DOCUMENT(folders, @parentKey)
         FILTER @parentKey == null || (parent != null && parent.scopeKey == @scopeKey && (!HAS(parent, "_internalDeletion") || parent._internalDeletion == null))
         INSERT @folder INTO folders RETURN NEW`,
        { folder: toArangoDoc(parsed), parentKey: parsed.parentFolderKey ?? null, scopeKey: parsed.scopeKey },
      );
      const created = await cursor.next();
      if (!created) throw new Error('Folder destination is pending deletion.');
      return folderSchema.parse(withArangoKey(created as Record<string, unknown>));
    },
    async insertDocument(document: Document): Promise<Document> {
      const parsed = documentSchema.parse({ ...document, ...canonicalRepresentations(document.html, document.content) });
      const cursor = await executor.query(
        `LET folder = @folderKey == null ? null : DOCUMENT(folders, @folderKey)
         FILTER @folderKey == null || (folder != null && folder.scopeKey == @scopeKey)
         FILTER @folderKey == null || ((!HAS(folder, "_internalDeletion") || folder._internalDeletion == null) && folder.deletedAt == null)
         INSERT @document INTO documents RETURN NEW`,
        { document: toArangoDoc(parsed), folderKey: parsed.folderKey, scopeKey: parsed.scopeKey },
      );
      const created = await cursor.next();
      if (!created) throw new Error('Document destination is pending deletion.');
      return documentSchema.parse(withArangoKey(created as Record<string, unknown>));
    },
    async insertShare(share: Omit<DocumentShare, 'deletedAt'>): Promise<DocumentShare> {
      const parsed = documentShareSchema.parse(share);
      const cursor = await executor.query(
        `LET document = DOCUMENT(documents, @documentKey)
         FILTER document != null && document.scopeKey == @scopeKey
         FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
         LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(folders, document.folderKey) : null
         FILTER folder == null || folder.scopeKey == @scopeKey
         FILTER folder == null || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
         INSERT @share INTO documentShares RETURN NEW`,
        { share: toArangoDoc(parsed), documentKey: parsed.documentKey, scopeKey: parsed.scopeKey },
      );
      const created = await cursor.next();
      if (!created) throw new Error('Share owner is pending deletion.');
      return documentShareSchema.parse(withArangoKey(created as Record<string, unknown>));
    },
    async createVersion(version: Omit<DocumentVersion, 'key' | 'version' | 'createdAt' | 'deletedAt'>): Promise<DocumentVersion> {
      const snapshot = documentVersionSchema.omit({ version: true }).parse({
        ...version,
        ...canonicalRepresentations(version.html, version.content),
        key: newId(),
        createdAt: new Date().toISOString(),
      });
      const cursor = await executor.query(`
        LET document = DOCUMENT(documents, @documentKey)
        FILTER document != null && document.scopeKey == @scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
         LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(folders, document.folderKey) : null
         FILTER folder == null || folder.scopeKey == @scopeKey
         FILTER folder == null || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
        LET nextVersion = FIRST(
          FOR existing IN documentVersions
            FILTER existing.documentKey == @documentKey
            COLLECT AGGREGATE maximum = MAX(existing.version)
            RETURN (maximum || 0) + 1
        )
        INSERT MERGE(@snapshot, { version: nextVersion }) INTO documentVersions
        RETURN NEW
      `, { documentKey: version.documentKey, scopeKey: version.scopeKey, snapshot: toArangoDoc(snapshot) });
      const created = await cursor.next();
      if (!created) throw new Error('Version owner is pending deletion.');
      return documentVersionSchema.parse(withArangoKey(created as Record<string, unknown>));
    },
    updateFolder(scopeKey: string, key: string, patch: ScopedFolderPatch) {
      return scopedUpdate(executor, 'folders', scopeKey, key, patch, (value) => folderSchema.parse(value));
    },
    updateDocument(scopeKey: string, key: string, patch: ScopedDocumentPatch) {
      if (patch.content !== undefined && patch.html === undefined) throw new Error('Document content must be updated through HTML.');
      if (patch.html !== undefined && patch.embedding === undefined) throw new Error('Document HTML updates require a fresh embedding.');
      if (patch.html !== undefined && patch.content === undefined) throw new Error('Document HTML updates require derived content.');
      const preparedPatch = patch.html === undefined ? patch : { ...patch, ...canonicalRepresentations(patch.html, patch.content!) };
      return scopedUpdate(executor, 'documents', scopeKey, key, preparedPatch, (value) => documentSchema.parse(value));
    },
    updateShare(scopeKey: string, key: string, patch: Partial<Pick<DocumentShare, 'revokedAt' | 'deletedAt' | 'updatedAt'>>) {
      return scopedUpdate(executor, 'documentShares', scopeKey, key, patch, (value) => documentShareSchema.parse(value));
    },
    async setFolderDeletion(scopeKey: string, key: string, marker: Folder['_internalDeletion'] | undefined, owner?: string) {
      const { set, unset } = splitPatch({ _internalDeletion: marker });
      const cursor = await executor.query(`
        FOR current IN folders
          FILTER current._key == @key && current.scopeKey == @scopeKey
          FILTER @owner == null || current._internalDeletion.owner == @owner
          LIMIT 1
          UPDATE current WITH MERGE(@patch, ZIP(@unset, @unset[* RETURN null])) IN folders OPTIONS { keepNull: false }
          RETURN NEW
      `, { key, scopeKey, owner: owner ?? null, patch: set, unset });
      const value = await cursor.next();
      return value ? folderSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async setDocumentDeletion(scopeKey: string, key: string, marker: Document['_internalDeletion'] | undefined, owner?: string) {
      const { set, unset } = splitPatch({ _internalDeletion: marker });
      const cursor = await executor.query(`
        FOR current IN documents
          FILTER current._key == @key && current.scopeKey == @scopeKey
          FILTER @owner == null || current._internalDeletion.owner == @owner
          LIMIT 1
          UPDATE current WITH MERGE(@patch, ZIP(@unset, @unset[* RETURN null])) IN documents OPTIONS { keepNull: false }
          RETURN NEW
      `, { key, scopeKey, owner: owner ?? null, patch: set, unset });
      const value = await cursor.next();
      return value ? documentSchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    deleteFolder(scopeKey: string, key: string) { return scopedDelete(executor, 'folders', scopeKey, key); },
    deleteDocument(scopeKey: string, key: string) { return scopedDelete(executor, 'documents', scopeKey, key); },
    deleteVersion(scopeKey: string, key: string) { return scopedDelete(executor, 'documentVersions', scopeKey, key); },
    deleteShare(scopeKey: string, key: string) { return scopedDelete(executor, 'documentShares', scopeKey, key); },
  };
}

export const archivePersistence = createArchivePersistence(db as unknown as ArchiveQueryExecutor);

export function withArchivePersistenceTransaction<T>(
  operation: (persistence: ReturnType<typeof createArchivePersistence>) => Promise<T>,
): Promise<T> {
  return withTransaction(['folders', 'documents', 'documentVersions', 'documentShares'], (transaction) =>
    operation(createArchivePersistence(transaction as unknown as ArchiveQueryExecutor)));
}
