import { aql, type Database } from 'arangojs';
import type { Document } from '@/lib/db/documents.node';
import type { Folder } from '@/lib/db/folders.node';
import type { Book } from '@/lib/db/books.node';
import type { BookChapter } from '@/lib/db/book-chapters.node';
import type { Collection } from '@/lib/db/collections.node';
import type { CollectionImage } from '@/lib/db/collection-images.node';
import type { Image } from '@/lib/db/images.node';
import { toArangoDoc } from '@/lib/db/base';
import { db, withTransaction } from '@/lib/db/client';
import { INITIAL_WORKSPACE_DOCUMENT_IDS, INITIAL_WORKSPACE_FOLDER_IDS, initialWorkspaceDocumentKey, initialWorkspaceFolderKey, initialWorkspaceGalleryCollectionKey, initialWorkspaceGalleryImageKey } from '@/lib/initial-workspace-content-identifiers';
import { INITIAL_GALLERY_ASSET_MANIFEST } from '@/lib/initial-gallery-assets';

export type VersionedInitialFolder = { introducedInVersion: number; value: Folder };
export type VersionedInitialDocument = { introducedInVersion: number; value: Document };
export type VersionedInitialBook = { introducedInVersion: number; value: Book };
export type VersionedInitialBookChapter = { introducedInVersion: number; value: BookChapter };
export type VersionedInitialGalleryCollection = { introducedInVersion: number; value: Collection };
export type VersionedInitialGalleryRelation = { introducedInVersion: number; value: CollectionImage };
export type VersionedInitialGalleryImage = { introducedInVersion: number; value: Image };
export type InitialGalleryOwner = { membershipKey: string; userKey: string };

export interface InitialWorkspaceContentRepository {
  currentVersion(scopeKey: string): Promise<number>;
  existingKeys?(scopeKey: string): Promise<{ folderKeys: string[]; documentKeys: string[]; galleryCollectionKeys?: string[]; galleryImageKeys?: string[]; galleryRelationKeys?: string[] }>;
  galleryOwner?(scopeKey: string): Promise<InitialGalleryOwner | null>;
  insertMissing?(input: { folders: Folder[]; documents: Document[]; galleryCollections: Collection[]; galleryImages: Image[]; galleryRelations: CollectionImage[] }): Promise<number>;
  publish(input: { scopeKey: string; version: number; folders: VersionedInitialFolder[]; documents: VersionedInitialDocument[]; books: VersionedInitialBook[]; bookChapters: VersionedInitialBookChapter[]; galleryCollections: VersionedInitialGalleryCollection[]; galleryImages: VersionedInitialGalleryImage[]; galleryRelations: VersionedInitialGalleryRelation[] }): Promise<boolean>;
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
      const galleryImageKeys = INITIAL_GALLERY_ASSET_MANIFEST.map((asset) => initialWorkspaceGalleryImageKey(scopeKey, asset.id));
      const cursor = await database.query(aql`
       RETURN {
          folderKeys: (FOR folder IN folders FILTER folder._key IN ${folderKeys} && folder.scopeKey == ${scopeKey} && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null) RETURN folder._key),
           documentKeys: (FOR document IN documents FILTER document._key IN ${documentKeys} && document.scopeKey == ${scopeKey} && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document._key),
           galleryCollectionKeys: (FOR collection IN collections FILTER collection._key == ${initialWorkspaceGalleryCollectionKey(scopeKey)} && collection.scopeKey == ${scopeKey} RETURN collection._key),
           galleryImageKeys: (FOR image IN images FILTER image._key IN ${galleryImageKeys} && image.scopeKey == ${scopeKey} RETURN image._key),
           galleryRelationKeys: (FOR relation IN collectionImages FILTER relation.scopeKey == ${scopeKey} && relation.collectionKey == ${initialWorkspaceGalleryCollectionKey(scopeKey)} RETURN relation._key)
        }
      `);
       return await cursor.next() ?? { folderKeys: [], documentKeys: [], galleryCollectionKeys: [], galleryImageKeys: [], galleryRelationKeys: [] };
     },
    async galleryOwner(scopeKey) {
      const cursor = await database.query(aql`FOR member IN scopeMembers FILTER member.scopeKey == ${scopeKey} && member.status == 'active' && member.role == 'owner' LET userTeam = DOCUMENT(userTeams, member.userTeamKey) FILTER userTeam != null && userTeam.status == 'active' SORT member._key ASC LIMIT 1 RETURN { membershipKey: member.userTeamKey, userKey: userTeam.userId }`);
      return await cursor.next() ?? null;
    },
    async insertMissing(input) {
      const folders = input.folders.map((value) => toArangoDoc(value));
      const documents = input.documents.map((value) => toArangoDoc(value));
      const galleryCollections = input.galleryCollections.map((value) => toArangoDoc(value));
      const galleryImages = input.galleryImages.map((value) => toArangoDoc(value));
      const galleryRelations = input.galleryRelations.map((value) => toArangoDoc(value));
      // Arango forbids DOCUMENT reads after a modification in one AQL query.
      const createdFolders = await (await database.query(aql`
        FOR value IN ${folders}
          FILTER DOCUMENT(folders, value._key) == null
          INSERT value IN folders
          RETURN NEW._key
      `)).all();
      const createdDocuments = await (await database.query(aql`
        FOR value IN ${documents}
          FILTER DOCUMENT(documents, value._key) == null
          INSERT value IN documents
          RETURN NEW._key
      `)).all();
      const { createdCollections, createdImages, createdRelations } = await transaction(['collections', 'collectionImages', 'images'], async (trx) => {
        const createdCollections = await (await trx.query(aql`FOR value IN ${galleryCollections} FILTER DOCUMENT(collections, value._key) == null INSERT value IN collections RETURN NEW._key`)).all();
        const createdImages = await (await trx.query(aql`FOR value IN ${galleryImages} FILTER DOCUMENT(images, value._key) == null INSERT value IN images RETURN NEW._key`)).all();
        const createdRelations = await (await trx.query(aql`FOR value IN ${galleryRelations} FILTER DOCUMENT(collectionImages, value._key) == null && DOCUMENT(collections, value.collectionKey) != null && DOCUMENT(images, value.imageKey) != null INSERT value IN collectionImages RETURN NEW._key`)).all();
        return { createdCollections, createdImages, createdRelations };
      });
      return createdFolders.length + createdDocuments.length + createdCollections.length + createdImages.length + createdRelations.length;
    },
    async publish(input) {
      return transaction(['scopes', 'folders', 'documents', 'books', 'bookChapters', 'collections', 'collectionImages', 'images'], async (trx) => {
        const folders = input.folders.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const documents = input.documents.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const books = input.books.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const bookChapters = input.bookChapters.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const galleryCollections = input.galleryCollections.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const galleryImages = input.galleryImages.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const galleryRelations = input.galleryRelations.map((item) => ({ introducedInVersion: item.introducedInVersion, value: toArangoDoc(item.value) }));
        const cursor = await trx.query(aql`
          FOR scope IN scopes
          FILTER scope._key == ${input.scopeKey}
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
           LET createdGalleryCollections = (
             FOR item IN ${galleryCollections}
               FILTER item.introducedInVersion > previousVersion
               UPSERT { _key: item.value._key }
                 INSERT item.value
                 UPDATE {} IN collections
               RETURN NEW._key
           )
           LET createdGalleryImages = (
             FOR item IN ${galleryImages}
               FILTER item.introducedInVersion > previousVersion
               UPSERT { _key: item.value._key }
                 INSERT item.value
                 UPDATE {} IN images
               RETURN NEW._key
           )
           LET createdGalleryRelations = (
             FOR item IN ${galleryRelations}
               FILTER item.introducedInVersion > previousVersion
               UPSERT { _key: item.value._key }
                 INSERT item.value
                 UPDATE {} IN collectionImages
               RETURN NEW._key
           )
           UPDATE scope WITH { initialContentVersion: ${input.version} } IN scopes
           RETURN LENGTH(createdFolders) + LENGTH(createdDocuments) + LENGTH(createdBooks) + LENGTH(createdBookChapters) + LENGTH(createdGalleryCollections) + LENGTH(createdGalleryImages) + LENGTH(createdGalleryRelations)
        `);
        return await cursor.next() !== undefined;
      });
    },
  };
}

export const initialWorkspaceContentRepository = createInitialWorkspaceContentRepository();
