import { aql, type Database } from 'arangojs';
import type { Document } from '@/lib/db/documents.node';
import type { Folder } from '@/lib/db/folders.node';
import type { Book } from '@/lib/db/books.node';
import type { BookChapter } from '@/lib/db/book-chapters.node';
import { toArangoDoc } from '@/lib/db/base';
import { db, withTransaction } from '@/lib/db/client';

export type VersionedInitialFolder = { introducedInVersion: number; value: Folder };
export type VersionedInitialDocument = { introducedInVersion: number; value: Document };
export type VersionedInitialBook = { introducedInVersion: number; value: Book };
export type VersionedInitialBookChapter = { introducedInVersion: number; value: BookChapter };

export interface InitialWorkspaceContentRepository {
  currentVersion(scopeKey: string): Promise<number>;
  publish(input: { scopeKey: string; version: number; folders: VersionedInitialFolder[]; documents: VersionedInitialDocument[]; books: VersionedInitialBook[]; bookChapters: VersionedInitialBookChapter[] }): Promise<boolean>;
}

export function createInitialWorkspaceContentRepository(database: Database = db, transaction: typeof withTransaction = withTransaction): InitialWorkspaceContentRepository {
  return {
    async currentVersion(scopeKey) {
      const cursor = await database.query(aql`LET scope = DOCUMENT(scopes, ${scopeKey}) RETURN scope != null && HAS(scope, "initialContentVersion") && IS_NUMBER(scope.initialContentVersion) ? scope.initialContentVersion : 0`);
      return await cursor.next() ?? 0;
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
