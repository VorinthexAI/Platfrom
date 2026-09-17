import { aql, type Database } from 'arangojs';
import type { Document } from '@/lib/db/documents.node';
import type { Folder } from '@/lib/db/folders.node';
import type { Book } from '@/lib/db/books.node';
import type { BookChapter } from '@/lib/db/book-chapters.node';
import { toArangoDoc } from '@/lib/db/base';
import { db, withTransaction } from '@/lib/db/client';
import { INITIAL_WORKSPACE_DOCUMENT_IDS, INITIAL_WORKSPACE_FOLDER_IDS, initialWorkspaceDocumentKey, initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';

export type VersionedInitialFolder = { introducedInVersion: number; value: Folder };
export type VersionedInitialDocument = { introducedInVersion: number; value: Document };
export type VersionedInitialBook = { introducedInVersion: number; value: Book };
export type VersionedInitialBookChapter = { introducedInVersion: number; value: BookChapter };

export interface InitialWorkspaceContentRepository {
  currentVersion(scopeKey: string): Promise<number>;
  existingKeys?(scopeKey: string): Promise<{ folderKeys: string[]; documentKeys: string[] }>;
  insertMissing?(input: { folders: Folder[]; documents: Document[] }): Promise<number>;
  publish(input: { scopeKey: string; version: number; folders: VersionedInitialFolder[]; documents: VersionedInitialDocument[]; books: VersionedInitialBook[]; bookChapters: VersionedInitialBookChapter[] }): Promise<boolean>;
}

export function createInitialWorkspaceContentRepository(database: Database = db, transaction: typeof withTransaction = withTransaction): InitialWorkspaceContentRepository {
  return {
    async currentVersion(scopeKey) {
      const cursor = await database.query(aql`LET scope = DOCUMENT(scopes, ${scopeKey}) RETURN scope != null && HAS(scope, "initialContentVersion") && IS_NUMBER(scope.initialContentVersion) ? scope.initialContentVersion : 0`);
      return await cursor.next() ?? 0;
    },
    async existingKeys(scopeKey) {
      const folderKeys = INITIAL_WORKSPACE_FOLDER_IDS.map((id) => initialWorkspaceFolderKey(scopeKey, id));
      const documentKeys = INITIAL_WORKSPACE_DOCUMENT_IDS.map((id) => initialWorkspaceDocumentKey(scopeKey, id));
      const cursor = await database.query(aql`
        RETURN {
          folderKeys: (FOR folder IN folders FILTER folder._key IN ${folderKeys} && folder.scopeKey == ${scopeKey} && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null) RETURN folder._key),
          documentKeys: (FOR document IN documents FILTER document._key IN ${documentKeys} && document.scopeKey == ${scopeKey} && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document._key)
        }
      `);
      return await cursor.next() ?? { folderKeys: [], documentKeys: [] };
    },
    async insertMissing(input) {
      const folders = input.folders.map((value) => toArangoDoc(value));
      const documents = input.documents.map((value) => toArangoDoc(value));
      const cursor = await database.query(aql`
        LET createdFolders = (
          FOR value IN ${folders}
            FILTER DOCUMENT(folders, value._key) == null
            INSERT value IN folders
            RETURN NEW._key
        )
        LET createdDocuments = (
          FOR value IN ${documents}
            FILTER DOCUMENT(documents, value._key) == null
            INSERT value IN documents
            RETURN NEW._key
        )
        RETURN LENGTH(createdFolders) + LENGTH(createdDocuments)
      `);
      return Number(await cursor.next() ?? 0);
    },
    async publish(input) {
      return transaction(['scopes', 'folders', 'documents', 'books', 'bookChapters'], async (trx) => {
        const folders = input.folders.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const documents = input.documents.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const books = input.books.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const bookChapters = input.bookChapters.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const cursor = await trx.query(aql`
          LET scope = DOCUMENT(scopes, ${input.scopeKey})
          FILTER scope != null
          LET previousVersion = HAS(scope, "initialContentVersion") && IS_NUMBER(scope.initialContentVersion) ? scope.initialContentVersion : 0
          FILTER previousVersion < ${input.version}
          LET createdFolders = (
            FOR item IN ${folders}
              FILTER item.introducedInVersion > previousVersion
              UPSERT { _key: item.value._key }
                INSERT item.value
                UPDATE MERGE(UNSET(item.value, "_key", "createdAt", "isFavorite"), { _internalDeletion: null }) IN folders OPTIONS { keepNull: false }
              RETURN NEW._key
          )
          LET createdDocuments = (
            FOR item IN ${documents}
              FILTER item.introducedInVersion > previousVersion
              UPSERT { _key: item.value._key }
                INSERT item.value
                UPDATE MERGE(UNSET(item.value, "_key", "createdAt", "isFavorite"), {
                  storageKey: null,
                  sizeBytes: null,
                  coverImageKey: null,
                  currentVersionKey: null,
                  speechStorageKeys: null,
                  sourceStorageKeys: null,
                  _internalDeletion: null
                }) IN documents OPTIONS { keepNull: false }
              RETURN NEW._key
          )
          LET createdBooks = (
            FOR item IN ${books}
              FILTER item.introducedInVersion > previousVersion
              UPSERT { _key: item.value._key }
                INSERT item.value
                UPDATE MERGE(UNSET(item.value, "_key", "createdAt", "isFavorite"), { coverStorageKey: null }) IN books OPTIONS { keepNull: false }
              RETURN NEW._key
          )
          LET createdBookChapters = (
            FOR item IN ${bookChapters}
              FILTER item.introducedInVersion > previousVersion
              UPSERT { _key: item.value._key }
                INSERT item.value
                UPDATE UNSET(item.value, "_key", "createdAt") IN bookChapters
              RETURN NEW._key
          )
          UPDATE scope WITH { initialContentVersion: ${input.version} } IN scopes
          RETURN LENGTH(createdFolders) + LENGTH(createdDocuments) + LENGTH(createdBooks) + LENGTH(createdBookChapters)
        `);
        return await cursor.next() !== undefined;
      });
    },
  };
}

export const initialWorkspaceContentRepository = createInitialWorkspaceContentRepository();
