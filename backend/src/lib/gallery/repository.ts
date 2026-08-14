import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { type CollectionMember } from '@/lib/db/collection-members.node';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { galleryUploadSchema, getGalleryUploadById, insertGalleryUpload, updateGalleryUpload, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { getImageById, imageSchema, updateImage, type Image } from '@/lib/db/images.node';
import { visualIdentitySchema, type VisualIdentity } from '@/lib/db/visual-identities.node';
import { imageIdentitySchema, type ImageIdentity } from '@/lib/db/image-identities.node';
import { createMediaLibraryRepository, searchAccessibleImages, type AccessibleImageSearchInput, type AccessibleImageSearchResult, type MediaLibraryDatabase } from '@/lib/media-library';
import { findRedundantGalleryImageKeys } from '@/lib/gallery-duplicates';
import { newId } from '@/lib/ids';

export interface GallerySubjectRow { identity: VisualIdentity; reference: Image; imageCount: number; }
export interface GalleryCollectionRow { collection: Collection; count: number; cover: Image | null; }
export interface GalleryRepository {
  canManageScope(scopeKey: string, actorKey: string): Promise<boolean>;
  canAccessImage(scopeKey: string, imageKey: string, actorKey: string): Promise<boolean>;
  getCollection(scopeKey: string, collectionKey: string): Promise<Collection | null>;
  getImage(imageKey: string): Promise<Image | null>;
  addImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  createCollection(collection: Collection, member: CollectionMember): Promise<void>;
  listOverview(scopeKey: string, collectionKey?: string): Promise<{ collections: GalleryCollectionRow[]; images: Image[] }>;
  listRedundantCollectionImages(scopeKey: string, collectionKey: string): Promise<Image[]>;
  deleteDuplicateImages(scopeKey: string, collectionKey: string, imageKeys: string[], now: string): Promise<{ removedImageKeys: string[]; deletedImageKeys: string[] } | null>;
  transferCollectionImages(input: { scopeKey: string; actorKey: string; sourceCollectionKey: string; destinationCollectionKeys: string[]; imageKeys: string[]; mode: 'copy' | 'move'; now: string }): Promise<{ status: 'ok'; createdRelationCount: number } | { status: 'selection-changed' | 'destination-forbidden' }>;
  insertUpload(upload: GalleryUpload): Promise<GalleryUpload>;
  getUpload(uploadKey: string): Promise<GalleryUpload | null>;
  updateUpload(uploadKey: string, patch: Partial<Omit<GalleryUpload, 'key'>>): Promise<GalleryUpload>;
  searchAccessibleImages(input: AccessibleImageSearchInput): Promise<AccessibleImageSearchResult[]>;
  listMatchingIdentityNames(scopeKey: string, query: string): Promise<VisualIdentity[]>;
  listImagesForMatchingIdentityNames(scopeKey: string, query: string, collectionKey?: string): Promise<Array<{ image: Image; score: number }>>;
  listIdentityMatches(scopeKey: string, embedding: number[]): Promise<Array<{ identityKey: string; confidence: number }>>;
  persistIdentityMatches(scopeKey: string, identityKey: string, matches: Array<{ imageKey: string; confidence: number }>): Promise<void>;
  setImageFavorite(scopeKey: string, imageKey: string, isFavorite: boolean, now: string): Promise<Image | null>;
  listSubjects(scopeKey: string, includeDeleted: boolean): Promise<GallerySubjectRow[]>;
  getSubject(scopeKey: string, identityKey: string, includeDeleted: boolean): Promise<GallerySubjectRow | null>;
  createSubject(identity: VisualIdentity, relations: ImageIdentity[], referenceImageKeys: string[]): Promise<boolean>;
  listSubjectImages(scopeKey: string, identityKey: string): Promise<Array<{ image: Image; confidence: number }>>;
  setSubjectDeleted(scopeKey: string, identityKey: string, deleted: boolean, now: string): Promise<boolean>;
}

type TransactionRunner = <T>(collections: string[] | { read: string[]; write: string[] }, operation: (database: MediaLibraryDatabase) => Promise<T>) => Promise<T>;
const runTransaction: TransactionRunner = (collections, operation) => withTransaction(collections, (transaction) => operation(transaction));
const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));
async function all(database: MediaLibraryDatabase, query: string, bindVars: Record<string, unknown>) { return (await database.query(query, bindVars)).all(); }

async function redundantCollectionImages(database: MediaLibraryDatabase, scopeKey: string, collectionKey: string) {
  const rows = await all(database, `FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey) FILTER caption != null && caption.scopeKey == @scopeKey && caption.perceptualHash != null LET protected = LENGTH(FOR identityRelation IN imageIdentities FILTER identityRelation.scopeKey == @scopeKey && identityRelation.imageKey == image._key && identityRelation.isReference == true LIMIT 1 RETURN 1) > 0 SORT image.createdAt ASC, image._key ASC RETURN { image, perceptualHash: caption.perceptualHash, protected }`, { scopeKey, collectionKey }) as Array<{ image: unknown; perceptualHash: string; protected: boolean }>;
  const parsed = rows.map((row) => ({ image: parse(imageSchema, row.image), perceptualHash: row.perceptualHash, protected: row.protected }));
  const redundantKeys = new Set(findRedundantGalleryImageKeys(parsed.map(({ image, perceptualHash, protected: isProtected }) => ({ key: image.key, createdAt: image.createdAt, perceptualHash, protected: isProtected }))));
  return parsed.map(({ image }) => image).filter(({ key }) => redundantKeys.has(key));
}

export function createGalleryRepository(database: MediaLibraryDatabase = db, transaction: TransactionRunner = runTransaction): GalleryRepository {
  const media = createMediaLibraryRepository(database);
  const subjectRows = async (query: string, bindVars: Record<string, unknown>) => (await all(database, query, bindVars) as Array<{ identity: unknown; reference: unknown; imageCount: number }>).map((row) => ({ identity: parse(visualIdentitySchema, row.identity), reference: parse(imageSchema, row.reference), imageCount: row.imageCount }));
  return {
    canManageScope: media.canManageScope,
    canAccessImage: media.canAccessImage,
    getCollection: media.getCollection,
    getImage: getImageById,
    addImageToCollection: media.addImageToCollection,
    createCollection(collection, member) { return transaction(['collections', 'collectionMembers'], async (tx) => { await tx.query('INSERT @collection INTO collections', { collection: toArangoDoc(collection) }); await tx.query('INSERT @member INTO collectionMembers', { member: toArangoDoc(member) }); }); },
    async listOverview(scopeKey, collectionKey) {
      const collectionRows = await all(database, 'FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.deletedAt == null LET imageKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key RETURN relation.imageKey) LET cover = collection.coverImageKey == null ? (LENGTH(imageKeys) == 0 ? null : DOCUMENT(images, imageKeys[0])) : DOCUMENT(images, collection.coverImageKey) SORT collection.name ASC RETURN { collection, count: LENGTH(imageKeys), cover }', { scopeKey }) as Array<{ collection: unknown; count: number; cover: unknown | null }>;
      const imageRows = await all(database, 'FOR image IN images FILTER image.scopeKey == @scopeKey && image.deletedAt == null FILTER @collectionKey == null || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == image._key LIMIT 1 RETURN 1) > 0 SORT image.createdAt DESC, image._key ASC LIMIT 500 RETURN image', { scopeKey, collectionKey: collectionKey ?? null });
      return { collections: collectionRows.map((row) => ({ collection: parse(collectionSchema, row.collection), count: row.count, cover: row.cover ? parse(imageSchema, row.cover) : null })), images: imageRows.map((value) => parse(imageSchema, value)) };
    },
    listRedundantCollectionImages: (scopeKey, collectionKey) => redundantCollectionImages(database, scopeKey, collectionKey),
    deleteDuplicateImages(scopeKey, collectionKey, imageKeys, now) { return transaction({ read: ['imageCaptions', 'visualIdentities'], write: ['images', 'collectionImages', 'collections', 'imageIdentities'] }, async (tx) => {
      const allowed = new Set((await redundantCollectionImages(tx, scopeKey, collectionKey)).map(({ key }) => key));
      if (imageKeys.some((key) => !allowed.has(key))) return null;
      await tx.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', { imageKeys, scopeKey, collectionKey });
      await tx.query('FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections', { imageKeys, scopeKey, collectionKey, now });
      const deletedImageKeys = await all(tx, 'FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey && image.deletedAt == null LET collectionCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LIMIT 1 RETURN 1) LET subjectCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LET identity = DOCUMENT(visualIdentities, relation.identityKey) FILTER identity != null && identity.deletedAt == null LIMIT 1 RETURN 1) FILTER collectionCount == 0 && subjectCount == 0 UPDATE image WITH { deletedAt: @now, updatedAt: @now } IN images RETURN OLD._key', { imageKeys, scopeKey, now }) as string[];
      return { removedImageKeys: imageKeys, deletedImageKeys };
    }); },
    transferCollectionImages(input) { return transaction({ read: ['images', 'collectionMembers'], write: ['collections', 'collectionImages'] }, async (tx) => {
      const source = await all(tx, 'FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) LET relation = FIRST(FOR candidate IN collectionImages FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @sourceCollectionKey && candidate.imageKey == imageKey LIMIT 1 RETURN candidate) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null && relation != null RETURN imageKey', input);
      if (source.length !== input.imageKeys.length) return { status: 'selection-changed' as const };
      const destinations = await all(tx, 'FOR collectionKey IN @collectionKeys LET collection = DOCUMENT(collections, collectionKey) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER collection != null && collection.scopeKey == @scopeKey && collection.deletedAt == null && member != null RETURN collectionKey', { collectionKeys: input.destinationCollectionKeys, scopeKey: input.scopeKey, actorKey: input.actorKey });
      if (destinations.length !== input.destinationCollectionKeys.length) return { status: 'destination-forbidden' as const };
      let createdRelationCount = 0;
      for (const collectionKey of input.destinationCollectionKeys) for (const imageKey of input.imageKeys) {
        const relation = collectionImageSchema.parse({ key: newId(), scopeKey: input.scopeKey, collectionKey, imageKey, addedByKey: input.actorKey, createdAt: input.now });
        const created = await all(tx, 'UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages RETURN OLD == null', { scopeKey: input.scopeKey, collectionKey, imageKey, relation: toArangoDoc(relation) });
        if (created[0] === true) createdRelationCount += 1;
      }
      if (input.mode === 'move') { await tx.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @sourceCollectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', input); await tx.query('FOR collection IN collections FILTER collection._key == @sourceCollectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections', input); }
      return { status: 'ok' as const, createdRelationCount };
    }); },
    insertUpload: insertGalleryUpload,
    getUpload: getGalleryUploadById,
    updateUpload: updateGalleryUpload,
    searchAccessibleImages: (input) => searchAccessibleImages(input, database),
    async listMatchingIdentityNames(scopeKey, query) { return (await all(database, 'FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER CONTAINS(LOWER(@query), LOWER(identity.name)) RETURN identity', { scopeKey, query })).map((value) => parse(visualIdentitySchema, value)); },
    async listImagesForMatchingIdentityNames(scopeKey, query, collectionKey) { return (await all(database, 'FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER CONTAINS(LOWER(@query), LOWER(identity.name)) FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null FILTER @collectionKey == null || LENGTH(FOR collectionImage IN collectionImages FILTER collectionImage.scopeKey == @scopeKey && collectionImage.collectionKey == @collectionKey && collectionImage.imageKey == image._key LIMIT 1 RETURN 1) > 0 SORT relation.confidence DESC, image.createdAt DESC RETURN { image, score: relation.confidence }', { scopeKey, query, collectionKey: collectionKey ?? null }) as Array<{ image: unknown; score: number }>).map((row) => ({ image: parse(imageSchema, row.image), score: row.score })); },
    async listIdentityMatches(scopeKey, embedding) { return await all(database, 'FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER IS_ARRAY(identity.embedding) && LENGTH(identity.embedding) == @dimensions LET confidence = COSINE_SIMILARITY(identity.embedding, @embedding) FILTER IS_NUMBER(confidence) && confidence >= 0.82 RETURN { identityKey: identity._key, confidence }', { scopeKey, embedding, dimensions: embedding.length }) as Array<{ identityKey: string; confidence: number }>; },
    async persistIdentityMatches(scopeKey, identityKey, matches) { if (!matches.length) return; const now = new Date().toISOString(); await transaction(['imageIdentities'], async (tx) => { for (const match of matches) { const relation = imageIdentitySchema.parse({ key: newId(), scopeKey, imageKey: match.imageKey, identityKey, confidence: match.confidence, isReference: false, createdAt: now }); await tx.query('UPSERT { scopeKey: @scopeKey, identityKey: @identityKey, imageKey: @imageKey } INSERT @relation UPDATE { confidence: MAX([OLD.confidence, @confidence]) } IN imageIdentities', { scopeKey, identityKey, imageKey: match.imageKey, confidence: match.confidence, relation: toArangoDoc(relation) }); } }); },
    async setImageFavorite(scopeKey, imageKey, isFavorite, now) { const image = await getImageById(imageKey); if (!image || image.scopeKey !== scopeKey || image.deletedAt) return null; return updateImage(imageKey, { isFavorite, updatedAt: now }); },
    listSubjects: (scopeKey, includeDeleted) => subjectRows('FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey FILTER @includeDeleted || identity.deletedAt == null LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.deletedAt == null RETURN 1) SORT identity.deletedAt == null DESC, identity.name ASC, identity._key ASC RETURN { identity, reference, imageCount }', { scopeKey, includeDeleted }),
    async getSubject(scopeKey, identityKey, includeDeleted) { return (await subjectRows('FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey FILTER @includeDeleted || identity.deletedAt == null LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.deletedAt == null RETURN 1) LIMIT 1 RETURN { identity, reference, imageCount }', { scopeKey, identityKey, includeDeleted }))[0] ?? null; },
    createSubject(identity, relations, referenceImageKeys) { return transaction({ read: ['images'], write: ['visualIdentities', 'imageIdentities'] }, async (tx) => { const references = await all(tx, 'FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey && image.deletedAt == null RETURN image._key', { imageKeys: referenceImageKeys, scopeKey: identity.scopeKey }); if (references.length !== referenceImageKeys.length) return false; await tx.query('INSERT @identity INTO visualIdentities', { identity: toArangoDoc(identity) }); for (const relation of relations) await tx.query('INSERT @relation INTO imageIdentities', { relation: toArangoDoc(relation) }); return true; }); },
    async listSubjectImages(scopeKey, identityKey) { return (await all(database, 'FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == @identityKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null SORT relation.confidence DESC, image.createdAt DESC RETURN { image, confidence: relation.confidence }', { scopeKey, identityKey }) as Array<{ image: unknown; confidence: number }>).map((row) => ({ image: parse(imageSchema, row.image), confidence: row.confidence })); },
    setSubjectDeleted(scopeKey, identityKey, deleted, now) { return transaction({ read: ['images'], write: ['visualIdentities'] }, async (tx) => Boolean((await all(tx, 'FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER @deleted || (reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null) LIMIT 1 UPDATE identity WITH { deletedAt: @deletedAt, updatedAt: @now } IN visualIdentities RETURN NEW', { identityKey, scopeKey, deleted, deletedAt: deleted ? now : null, now }))[0])); },
  };
}

let defaultRepository: GalleryRepository | undefined;
export function getDefaultGalleryRepository() { return defaultRepository ??= createGalleryRepository(); }
