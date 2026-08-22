import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { collectionMemberSchema, type CollectionMember } from '@/lib/db/collection-members.node';
import { collectionInviteSchema, type CollectionInvite } from '@/lib/db/collection-invites.node';
import { shareSchema, type Share } from '@/lib/db/shares.node';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { galleryUploadSchema, getGalleryUploadById, updateGalleryUpload, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { getImageById, imageSchema, type Image } from '@/lib/db/images.node';
import { visualIdentitySchema, type VisualIdentity } from '@/lib/db/visual-identities.node';
import { imageIdentitySchema, type ImageIdentity } from '@/lib/db/image-identities.node';
import { createMediaLibraryRepository, searchAccessibleImages, type AccessibleImageSearchInput, type AccessibleImageSearchResult, type MediaLibraryDatabase } from '@/lib/media-library';
import { findRedundantGalleryImageKeys } from '@/lib/gallery-duplicates';
import { newId } from '@/lib/ids';
import { cursorPage, decodeCursor, encodeCursor, type CursorPage } from '@/lib/cursor-pagination';
import { z } from 'zod';
import { imageCollectionHighlightSchema, type ImageCollectionHighlight } from '@/lib/db/image-collection-highlights.node';
import { imageCollectionMemorySchema, type ImageCollectionMemory } from '@/lib/db/image-collection-memories.node';

export interface GallerySubjectRow { identity: VisualIdentity; reference: Image; imageCount: number; }
export interface GalleryCollectionRow { collection: Collection; count: number; cover: Image | null; isOwned: boolean; }
export type GalleryCollectionRole = 'owner' | 'collaborator' | 'viewer';
export interface GalleryMemberRow { member: CollectionMember; displayName: string; joinedAt: string; }
export interface GalleryInviteRow { invite: CollectionInvite; collection: Collection; inviterDisplayName: string; }
export interface GalleryShareRow { share: Share; responseCiphertext: string; }
export interface GalleryHighlightRow { highlight: ImageCollectionHighlight; images: Image[]; }
export interface GalleryMemoryRow { memory: ImageCollectionMemory; image: Image; collectionKeys: string[]; }
export interface GalleryMemoryCandidate { image: Image; caption: string; captionScore: number; identityNames: string[]; }
export interface GalleryRepository {
  canManageScope(scopeKey: string, actorKey: string): Promise<boolean>;
  canAccessImage(scopeKey: string, imageKey: string, actorKey: string): Promise<boolean>;
  canAccessCollection(scopeKey: string, collectionKey: string, actorKey: string): Promise<boolean>;
  ownsCollection(scopeKey: string, collectionKey: string, actorKey: string): Promise<boolean>;
  ownsImage(scopeKey: string, imageKey: string, actorKey: string): Promise<boolean>;
  canMutateImage(scopeKey: string, imageKey: string, actorKey: string): Promise<boolean>;
  getCollectionRole(scopeKey: string, collectionKey: string, actorKey: string): Promise<GalleryCollectionRole | null>;
  getCollection(scopeKey: string, collectionKey: string): Promise<Collection | null>;
  getImage(imageKey: string): Promise<Image | null>;
  getVisualIdentity(scopeKey: string, identityKey: string, actorKey: string): Promise<VisualIdentity | null>;
  addImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  createCollection(collection: Collection, member: CollectionMember): Promise<boolean>;
  listOverview(input: { scopeKey: string; actorKey: string; collectionKey?: string; maxCaptionScore?: number; cursor?: string; limit: number }): Promise<{ collections: Array<GalleryCollectionRow & { role: GalleryCollectionRole }>; images: CursorPage<Image> }>;
  listCollectionMembers(scopeKey: string, collectionKey: string): Promise<GalleryMemberRow[]>;
  listPendingInvites(scopeKey: string, actorKey: string, now: string): Promise<GalleryInviteRow[]>;
  createCollectionInvite(invite: CollectionInvite, replay: { requestHash: string; responseCiphertext: string }): Promise<{ invite: CollectionInvite; requestHash: string; responseCiphertext: string } | null>;
  acceptCollectionInvite(scopeKey: string, inviteKey: string, actorKey: string, memberKey: string, now: string): Promise<CollectionMember | null>;
  rejectCollectionInvite(scopeKey: string, inviteKey: string, actorKey: string, now: string): Promise<string | null>;
  revokeCollectionInvite(scopeKey: string, collectionKey: string, inviteKey: string, ownerKey: string, now: string): Promise<boolean>;
  updateCollectionMemberRole(scopeKey: string, collectionKey: string, memberKey: string, role: Exclude<GalleryCollectionRole, 'owner'>, ownerKey: string): Promise<CollectionMember | null>;
  removeCollectionMember(scopeKey: string, collectionKey: string, memberKey: string, ownerKey: string): Promise<boolean>;
  leaveCollection(scopeKey: string, collectionKey: string, actorKey: string): Promise<boolean>;
  listCollectionShares(scopeKey: string, collectionKey: string, ownerKey: string): Promise<GalleryShareRow[]>;
  createCollectionShare(share: Share, ownerKey: string, replay: { requestHash: string; responseCiphertext: string }): Promise<{ share: Share; requestHash: string; responseCiphertext: string } | null>;
  setCollectionShareActive(scopeKey: string, collectionKey: string, shareKey: string, ownerKey: string, active: boolean, now: string): Promise<GalleryShareRow | null>;
  activateCollectionShare(scopeKey: string, tokenHash: string, actorKey: string, memberKey: string, now: string): Promise<CollectionMember | null>;
  getUserKeyByMemberKey(memberKey: string): Promise<string | null>;
  getInviteRecipientUserKey(inviteKey: string): Promise<string | null>;
  listCollectionUserKeys(collectionKey: string): Promise<string[]>;
  listScopeManagerUserKeys(scopeKey: string): Promise<string[]>;
  listRedundantCollectionImages(scopeKey: string, collectionKey: string): Promise<Image[]>;
  deleteDuplicateImages(scopeKey: string, collectionKey: string, imageKeys: string[], actorKey: string, now: string): Promise<{ removedImageKeys: string[]; deletedImageKeys: string[]; favoriteImageKeys: string[]; collectionKeys: string[]; memoryCollectionKeys: string[]; subjectChanged: boolean; storageKeys: string[] } | null>;
  deleteImages(scopeKey: string, imageKeys: string[], actorKey: string, now: string): Promise<{ deletedImageKeys: string[]; favoriteImageKeys: string[]; collectionKeys: string[]; memoryCollectionKeys: string[]; subjectChanged: boolean; hadUnfiledImages: boolean; storageKeys: string[] } | null>;
  transferCollectionImages(input: { scopeKey: string; actorKey: string; sourceCollectionKey: string; destinationCollectionKeys: string[]; imageKeys: string[]; mode: 'copy' | 'move'; now: string }): Promise<{ status: 'ok'; createdRelationCount: number; collectionKeys: string[] } | { status: 'selection-changed' | 'destination-forbidden' }>;
  insertUploads(uploads: GalleryUpload[]): Promise<GalleryUpload[]>;
  getUpload(uploadKey: string): Promise<GalleryUpload | null>;
  recoverUploadQueue(staleBefore: string, now: string): Promise<{ uploads: GalleryUpload[]; storageKeys: string[] }>;
  updateUpload(uploadKey: string, patch: Partial<Omit<GalleryUpload, 'key'>>): Promise<GalleryUpload>;
  queueUploads(input: { uploadKeys: string[]; organizationKey: string; scopeKey: string; actorKey: string; now: string }): Promise<GalleryUpload[] | null>;
  claimUploads(uploadKeys: string[], leaseId: string, now: string): Promise<GalleryUpload[]>;
  renewUploadLease(uploadKeys: string[], leaseId: string, now: string): Promise<number>;
  finalizeUpload(upload: GalleryUpload, relation: CollectionImage | null, leaseId: string, now: string, failureStatus: 'queued' | 'failed', errorCode: string): Promise<{ status: 'completed' } | { status: 'compensated'; effects: GalleryUploadCompensation } | { status: 'unchanged' }>;
  compensateUpload(uploadKey: string, scopeKey: string, leaseId: string, errorCode: string, status: 'queued' | 'failed', now: string): Promise<GalleryUploadCompensation | null>;
  canFinalizeUpload(upload: GalleryUpload): Promise<boolean>;
  searchAccessibleImages(input: AccessibleImageSearchInput): Promise<AccessibleImageSearchResult[]>;
  listMatchingIdentityNames(scopeKey: string, query: string, actorKey: string): Promise<VisualIdentity[]>;
  listIdentityMatches(scopeKey: string, embedding: number[], actorKey: string): Promise<Array<{ identityKey: string; confidence: number }>>;
  persistIdentityMatches(scopeKey: string, identityKey: string, matches: Array<{ imageKey: string; confidence: number }>): Promise<boolean>;
  setImageFavorite(scopeKey: string, imageKey: string, actorKey: string, isFavorite: boolean, now: string): Promise<{ image: Image; collectionKeys: string[] } | null>;
  updateImageDetails(scopeKey: string, imageKey: string, actorKey: string, filename: string, isFavorite: boolean, embedding: number[], now: string): Promise<{ image: Image; collectionKeys: string[] } | null>;
  updateCollectionDetails(scopeKey: string, collectionKey: string, actorKey: string, name: string, isFavorite: boolean, coverImageKey: string | null | undefined, embedding: number[], now: string): Promise<Collection | null>;
  deleteCollection(scopeKey: string, collectionKey: string, actorKey: string, now: string): Promise<{ status: 'deleted'; formerUserKeys: string[] } | { status: 'favorite' } | null>;
  listSubjects(scopeKey: string, actorKey: string): Promise<GallerySubjectRow[]>;
  getSubject(scopeKey: string, identityKey: string, actorKey: string): Promise<GallerySubjectRow | null>;
  createSubject(identity: VisualIdentity, relations: ImageIdentity[], referenceImageKeys: string[], actorKey: string): Promise<boolean>;
  listSubjectImages(scopeKey: string, identityKey: string, actorKey: string, collectionKey?: string): Promise<Array<{ image: Image; confidence: number }>>;
  deleteSubject(scopeKey: string, identityKey: string, actorKey: string): Promise<boolean>;
  listHighlightCandidates(scopeKey: string, collectionKey: string, actorKey: string): Promise<Array<{ image: Image; qualityScore: number }> | null>;
  createHighlight(highlight: ImageCollectionHighlight, actorKey: string): Promise<ImageCollectionHighlight | null>;
  listHighlights(scopeKey: string, collectionKey: string | undefined, actorKey: string): Promise<GalleryHighlightRow[]>;
  getHighlight(scopeKey: string, highlightKey: string, actorKey: string): Promise<GalleryHighlightRow | null>;
  deleteHighlight(scopeKey: string, highlightKey: string, actorKey: string): Promise<ImageCollectionHighlight | null>;
  listMemoryCandidates(scopeKey: string, collectionKey: string, actorKey: string): Promise<GalleryMemoryCandidate[] | null>;
  createMemory(memory: ImageCollectionMemory, collectionKey: string, actorKey: string): Promise<{ status: 'created' | 'replay' | 'exhausted' | 'forbidden'; collectionKeys: string[] }>;
  listMemories(scopeKey: string, collectionKey: string, actorKey: string): Promise<GalleryMemoryRow[]>;
  getAccessibleMemory(scopeKey: string, memoryKey: string, actorKey: string): Promise<GalleryMemoryRow | null>;
  deleteAccessibleMemory(scopeKey: string, memoryKey: string, collectionKey: string, actorKey: string): Promise<GalleryMemoryRow | null>;
}

export interface GalleryUploadCompensation { collectionKeys: string[]; subjectChanged: boolean; imageChanged: boolean; storageKeys: string[]; }

export function isCaptionScoreEligibleForGalleryCleanup(caption: unknown, scopeKey: string, maxCaptionScore: number): boolean {
  if (caption === null || typeof caption !== 'object') return false;
  const { scopeKey: captionScopeKey, score, scoreVersion } = caption as Record<string, unknown>;
  return captionScopeKey === scopeKey
    && typeof score === 'number'
    && Number.isFinite(score)
    && score >= 1
    && score <= 100
    && score <= maxCaptionScore
    && (scoreVersion === 1 || (scoreVersion === 0 && score > 1));
}

type TransactionRunner = <T>(collections: string[] | { read: string[]; write: string[] }, operation: (database: MediaLibraryDatabase) => Promise<T>) => Promise<T>;
const runTransaction: TransactionRunner = (collections, operation) => withTransaction(collections, (transaction) => operation(transaction));
const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));
async function all(database: MediaLibraryDatabase, query: string, bindVars: Record<string, unknown>) { return (await database.query(query, bindVars)).all(); }
async function userMutableCollection(database: MediaLibraryDatabase, scopeKey: string, collectionKey: string) {
  return Boolean((await all(database, 'FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" LIMIT 1 RETURN true', { scopeKey, collectionKey }))[0]);
}
async function userMutableMemory(database: MediaLibraryDatabase, scopeKey: string, memoryKey: string) {
  return Boolean((await all(database, 'LET memory = DOCUMENT(imageCollectionMemories, @memoryKey) FILTER memory != null && memory.scopeKey == @scopeKey LET managed = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == memory.imageKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.mutationPolicy == "system-only" LIMIT 1 RETURN 1) FILTER managed == 0 RETURN true', { scopeKey, memoryKey }))[0]);
}
const liveCollectionOwner = 'LET scope = DOCUMENT(scopes, @scopeKey) LET actor = DOCUMENT(userOrganizations, @ownerKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @ownerKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @ownerKey && member.role == "owner" LIMIT 1 RETURN member) FILTER scope != null && actor != null && actor.status == "active" && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null';

async function redundantCollectionImages(database: MediaLibraryDatabase, scopeKey: string, collectionKey: string) {
  const rows = await all(database, `FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey) FILTER caption != null && caption.scopeKey == @scopeKey && caption.perceptualHash != null LET protected = LENGTH(FOR identityRelation IN imageIdentities FILTER identityRelation.scopeKey == @scopeKey && identityRelation.imageKey == image._key && identityRelation.isReference == true LIMIT 1 RETURN 1) > 0 SORT image.createdAt ASC, image._key ASC RETURN { image, perceptualHash: caption.perceptualHash, protected }`, { scopeKey, collectionKey }) as Array<{ image: unknown; perceptualHash: string; protected: boolean }>;
  const parsed = rows.map((row) => ({ image: parse(imageSchema, row.image), perceptualHash: row.perceptualHash, protected: row.protected }));
  const redundantKeys = new Set(findRedundantGalleryImageKeys(parsed.map(({ image, perceptualHash, protected: isProtected }) => ({ key: image.key, createdAt: image.createdAt, perceptualHash, protected: isProtected }))));
  return parsed.map(({ image }) => image).filter(({ key }) => redundantKeys.has(key));
}

const overviewCursorV1Schema = z.object({
  version: z.literal(1), scopeKey: z.string().cuid(), collectionKey: z.string().cuid().nullable(), createdAt: z.string().datetime(), imageKey: z.string().cuid(),
}).strict();
const overviewCursorSchema = z.discriminatedUnion('version', [overviewCursorV1Schema, z.object({
  version: z.literal(2), scopeKey: z.string().cuid(), collectionKey: z.string().cuid().nullable(), maxCaptionScore: z.number().int().min(1).max(100), createdAt: z.string().datetime(), imageKey: z.string().cuid(),
}).strict()]);

async function compensateProcessingUpload(database: MediaLibraryDatabase, uploadKey: string, scopeKey: string, leaseId: string | null, errorCode: string, status: 'queued' | 'failed', now: string): Promise<GalleryUploadCompensation | null> {
  const claimed = await all(database, 'FOR upload IN galleryUploads FILTER upload._key == @uploadKey && upload.scopeKey == @scopeKey && upload.status == "processing" && (@leaseId == null || upload.processingLeaseId == @leaseId) LIMIT 1 RETURN upload.imageKey', { uploadKey, scopeKey, leaseId }) as string[];
  if (!claimed.length) return null;
  const imageKey = claimed[0]!;
  const imageRows = await all(database, 'FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN { storageKey: image.storageKey, imageCaptionKey: image.imageCaptionKey }', { scopeKey, imageKey }) as Array<{ storageKey: string; imageCaptionKey?: string | null }>;
  const imageChanged = imageRows.length > 0;
  const collectionKeys = await all(database, 'FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN DISTINCT relation.collectionKey', { scopeKey, imageKey }) as string[];
  const subjectChanged = Boolean((await all(database, 'FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey LIMIT 1 RETURN true', { scopeKey, imageKey }))[0]);
  await database.query('FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey == @imageKey UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections', { scopeKey, imageKey, now });
  await database.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey REMOVE relation IN collectionImages', { scopeKey, imageKey });
  await database.query('FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey REMOVE relation IN imageIdentities', { scopeKey, imageKey });
  const removedIdentityKeys = await all(database, 'FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.referenceImageKey == @imageKey LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key && relation.imageKey != @imageKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey SORT relation.isReference DESC, relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement == null REMOVE identity IN visualIdentities RETURN OLD._key', { scopeKey, imageKey }) as string[];
  await database.query('FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey IN @identityKeys REMOVE relation IN imageIdentities', { scopeKey, identityKeys: removedIdentityKeys });
  await database.query('FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.referenceImageKey == @imageKey LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key && relation.imageKey != @imageKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey SORT relation.isReference DESC, relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement != null UPDATE identity WITH { referenceImageKey: replacement, updatedAt: @now } IN visualIdentities', { scopeKey, imageKey, now });
  await database.query('FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey LET identity = DOCUMENT(visualIdentities, relation.identityKey) FILTER identity != null && identity.scopeKey == @scopeKey UPDATE relation WITH { isReference: relation.imageKey == identity.referenceImageKey } IN imageIdentities', { scopeKey });
  await database.query('FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey == @imageKey UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }', { scopeKey, imageKey, now });
  await database.query('FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey REMOVE image IN images', { scopeKey, imageKey });
  await database.query('FOR captionKey IN @captionKeys FILTER captionKey != null FILTER LENGTH(FOR image IN images FILTER image.imageCaptionKey == captionKey LIMIT 1 RETURN 1) == 0 FOR caption IN imageCaptions FILTER caption._key == captionKey REMOVE caption IN imageCaptions', { captionKeys: imageRows.map(({ imageCaptionKey }) => imageCaptionKey ?? null) });
  const transitioned = await all(database, 'FOR upload IN galleryUploads FILTER upload._key == @uploadKey && upload.scopeKey == @scopeKey && upload.status == "processing" && (@leaseId == null || upload.processingLeaseId == @leaseId) UPDATE upload WITH { status: @status, processingLeaseId: null, errorCode: @errorCode, updatedAt: @now } IN galleryUploads RETURN true', { uploadKey, scopeKey, leaseId, status, errorCode, now });
  if (!transitioned.length) throw new Error('Gallery upload compensation lost compare-and-set.');
  return { collectionKeys, subjectChanged, imageChanged, storageKeys: imageRows.flatMap(({ storageKey }) => storageKey ? [storageKey] : []) };
}

export function createGalleryRepository(database: MediaLibraryDatabase = db, transaction: TransactionRunner = runTransaction): GalleryRepository {
  const media = createMediaLibraryRepository(database);
  const subjectRows = async (query: string, bindVars: Record<string, unknown>) => (await all(database, query, bindVars) as Array<{ identity: unknown; reference: unknown; imageCount: number }>).map((row) => ({ identity: parse(visualIdentitySchema, row.identity), reference: parse(imageSchema, row.reference), imageCount: row.imageCount }));
  const highlightRows = async (query: string, bindVars: Record<string, unknown>) => (await all(database, query, bindVars) as Array<{ highlight: unknown; images: unknown[] }>).map((row) => ({ highlight: parse(imageCollectionHighlightSchema, row.highlight), images: row.images.map((image) => parse(imageSchema, image)) }));
  const memoryRows = async (query: string, bindVars: Record<string, unknown>) => (await all(database, query, bindVars) as Array<{ memory: unknown; image: unknown; collectionKeys?: string[] }>).map((row) => ({ memory: parse(imageCollectionMemorySchema, row.memory), image: parse(imageSchema, row.image), collectionKeys: row.collectionKeys ?? [] }));
  return {
    canManageScope: media.canManageScope,
    canAccessImage: media.canAccessImage,
    canAccessCollection: media.canAccessCollection,
    ownsCollection: media.ownsCollection,
    ownsImage: media.ownsImage,
    async canMutateImage(scopeKey, imageKey, actorKey) {
      return Boolean(
        (
          await all(
            database,
            `LET membership = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET image = DOCUMENT(images, @imageKey) FILTER membership != null && membership.status == "active" && scope != null && membership.organizationId == scope.organizationKey && image != null && image.scopeKey == @scopeKey && image.mutationPolicy != "system-only" LET scopeRole = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @actorKey && item.status == "active" LIMIT 1 RETURN item.role) LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN 1) LET roles = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey RETURN member.role == "member" ? "collaborator" : member.role) FILTER elevated || "owner" IN roles || (image.createdByKey == @actorKey && (relationCount == 0 || "collaborator" IN roles)) RETURN true`,
            { scopeKey, imageKey, actorKey },
          )
        )[0],
      );
    },
    async getCollectionRole(scopeKey, collectionKey, actorKey) {
      const value = (
        await all(
          database,
          `LET membership = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) FILTER membership != null && membership.status == "active" && scope != null && membership.organizationId == scope.organizationKey LET scopeRole = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @actorKey && item.status == "active" LIMIT 1 RETURN item.role) LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] LET collection = DOCUMENT(collections, @collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey LET member = FIRST(FOR item IN collectionMembers FILTER item.scopeKey == @scopeKey && item.collectionKey == @collectionKey && item.memberKey == @actorKey LIMIT 1 RETURN item) FILTER elevated || member != null RETURN elevated ? "owner" : (member.role == "member" ? "collaborator" : member.role)`,
          { scopeKey, collectionKey, actorKey },
        )
      )[0];
      return value === "owner" || value === "collaborator" || value === "viewer"
        ? value
        : null;
    },
    getCollection: media.getCollection,
    getImage: getImageById,
    async getVisualIdentity(scopeKey, identityKey, actorKey) {
      if (!(await media.canManageScope(scopeKey, actorKey))) return null;
      const value = (
        await all(
          database,
          "FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey LIMIT 1 RETURN identity",
          { scopeKey, identityKey, actorKey },
        )
      )[0];
      return value ? parse(visualIdentitySchema, value) : null;
    },
    addImageToCollection: media.addImageToCollection,
    createCollection(collection, member) {
      return transaction(
        {
          read: ["scopes", "userOrganizations", "scopeMembers"],
          write: ["collections", "collectionMembers"],
        },
        async (tx) => {
          const allowed = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey FILTER actor.orgRole IN ["owner", "admin"] || scopeMember.role IN ["owner", "admin", "moderator"] RETURN true',
            { scopeKey: collection.scopeKey, actorKey: member.memberKey },
          );
          if (!allowed.length) return false;
          await tx.query("INSERT @collection INTO collections", {
            collection: toArangoDoc(collection),
          });
          await tx.query("INSERT @member INTO collectionMembers", {
            member: toArangoDoc(member),
          });
          return true;
        },
      );
    },
    async listOverview({
      scopeKey,
      actorKey,
      collectionKey,
      maxCaptionScore,
      cursor,
      limit,
    }) {
      const after = decodeCursor(cursor, overviewCursorSchema);
      if (
        after &&
        (after.scopeKey !== scopeKey ||
          after.collectionKey !== (collectionKey ?? null) ||
          (after.version === 1
            ? maxCaptionScore !== undefined
            : after.maxCaptionScore !== maxCaptionScore))
      )
        throw new z.ZodError([
          {
            code: "custom",
            path: ["cursor"],
            message:
              "Cursor does not belong to this Gallery location or filter.",
          },
        ]);
      const access = `LET membership = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) FILTER membership != null && membership.status == "active" && scope != null && membership.organizationId == scope.organizationKey LET scopeRole = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @actorKey && item.status == "active" LIMIT 1 RETURN item.role) LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]`;
      const collectionRows = (await all(
        database,
        `${access} FOR collection IN collections FILTER collection.scopeKey == @scopeKey LET member = FIRST(FOR item IN collectionMembers FILTER item.scopeKey == @scopeKey && item.collectionKey == collection._key && item.memberKey == @actorKey LIMIT 1 RETURN item) FILTER elevated || member != null LET role = elevated ? "owner" : (member.role == "member" ? "collaborator" : member.role) LET explicitOwnerCount = LENGTH(FOR item IN collectionMembers FILTER item.scopeKey == @scopeKey && item.collectionKey == collection._key && item.role == "owner" RETURN 1) LET isOwned = member != null && member.role == "owner" || elevated && explicitOwnerCount == 0 LET imageKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key SORT relation.createdAt ASC, relation._key ASC RETURN relation.imageKey) LET cover = collection.coverImageKey == null ? (LENGTH(imageKeys) == 0 ? null : DOCUMENT(images, imageKeys[0])) : DOCUMENT(images, collection.coverImageKey) SORT collection.name ASC RETURN { collection, count: LENGTH(imageKeys), cover, role, isOwned }`,
        { scopeKey, actorKey },
      )) as Array<{
        collection: unknown;
        count: number;
        cover: unknown | null;
        role: GalleryCollectionRole;
        isOwned: boolean;
      }>;
      const captionFilter =
        maxCaptionScore === undefined
          ? ""
          : " LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey) FILTER caption != null && caption.scopeKey == @scopeKey && IS_NUMBER(caption.score) && caption.score >= 1 && caption.score <= 100 && caption.score <= @maxCaptionScore && (caption.scoreVersion == 1 || (caption.scoreVersion == 0 && caption.score > 1))";
      const imageRows = await all(
        database,
        `${access} FOR image IN images FILTER image.scopeKey == @scopeKey LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key RETURN 1) LET accessibleCollections = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key FILTER @collectionKey == null || relation.collectionKey == @collectionKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null LET member = FIRST(FOR item IN collectionMembers FILTER item.scopeKey == @scopeKey && item.collectionKey == relation.collectionKey && item.memberKey == @actorKey LIMIT 1 RETURN item) FILTER elevated || member != null RETURN 1) FILTER @collectionKey == null ? (elevated || (image.createdByKey == @actorKey && relationCount == 0) || LENGTH(accessibleCollections) > 0) : LENGTH(accessibleCollections) > 0${captionFilter} FILTER @afterCreatedAt == null || image.createdAt < @afterCreatedAt || (image.createdAt == @afterCreatedAt && image._key > @afterImageKey) SORT image.createdAt DESC, image._key ASC LIMIT @queryLimit RETURN image`,
        {
          scopeKey,
          actorKey,
          collectionKey: collectionKey ?? null,
          ...(maxCaptionScore === undefined ? {} : { maxCaptionScore }),
          afterCreatedAt: after?.createdAt ?? null,
          afterImageKey: after?.imageKey ?? "",
          queryLimit: limit + 1,
        },
      );
      const parsedImages = imageRows.map((value) => parse(imageSchema, value));
      return {
        collections: collectionRows.map((row) => ({
          collection: parse(collectionSchema, row.collection),
          count: row.count,
          cover: row.cover ? parse(imageSchema, row.cover) : null,
          role: row.role,
          isOwned: row.isOwned,
        })),
        images: cursorPage(parsedImages, limit, (image) =>
          maxCaptionScore === undefined
            ? encodeCursor({
                version: 1,
                scopeKey,
                collectionKey: collectionKey ?? null,
                createdAt: image.createdAt,
                imageKey: image.key,
              })
            : encodeCursor({
                version: 2,
                scopeKey,
                collectionKey: collectionKey ?? null,
                maxCaptionScore,
                createdAt: image.createdAt,
                imageKey: image.key,
              }),
        ),
      };
    },
    async listCollectionMembers(scopeKey, collectionKey) {
      return (
        (await all(
          database,
          'FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey LET membership = DOCUMENT(userOrganizations, member.memberKey) LET user = membership == null ? null : DOCUMENT(users, membership.userId) FILTER membership != null && membership.status == "active" && user != null LET displayName = LENGTH(TRIM(user.name || "")) > 0 ? TRIM(user.name) : (LENGTH(TRIM(user.alias || "")) > 0 ? TRIM(user.alias) : "Member") SORT member.role == "owner" DESC, member.createdAt ASC RETURN { member, displayName, joinedAt: member.createdAt }',
          { scopeKey, collectionKey },
        )) as Array<{ member: unknown; displayName: string; joinedAt: string }>
      ).map((row) => ({
        member: parse(collectionMemberSchema, row.member),
        displayName: row.displayName,
        joinedAt: row.joinedAt,
      }));
    },
    async listPendingInvites(scopeKey, actorKey, now) {
      return (
        (await all(
          database,
          'LET membership = DOCUMENT(userOrganizations, @actorKey) LET user = membership == null ? null : DOCUMENT(users, membership.userId) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && user != null && scope != null && membership.organizationId == scope.organizationKey LET manager = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] FOR invite IN collectionInvites FILTER invite.scopeKey == @scopeKey && invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null && (invite.expiresAt == null || invite.expiresAt > @now) LET ownsCollection = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == invite.collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN 1) > 0 FILTER manager || ownsCollection || invite.inviteeKey == @actorKey || invite.email == LOWER(user.email) LET collection = DOCUMENT(collections, invite.collectionKey) LET inviterMembership = DOCUMENT(userOrganizations, invite.invitedByKey) LET inviter = inviterMembership == null ? null : DOCUMENT(users, inviterMembership.userId) FILTER collection != null && collection.scopeKey == @scopeKey && inviter != null LET inviterDisplayName = LENGTH(TRIM(inviter.name || "")) > 0 ? TRIM(inviter.name) : (LENGTH(TRIM(inviter.alias || "")) > 0 ? TRIM(inviter.alias) : "Member") SORT invite.createdAt DESC RETURN { invite, collection, inviterDisplayName }',
          { scopeKey, actorKey, now },
        )) as Array<{
          invite: unknown;
          collection: unknown;
          inviterDisplayName: string;
        }>
      ).map((row) => ({
        invite: parse(collectionInviteSchema, row.invite),
        collection: parse(collectionSchema, row.collection),
        inviterDisplayName: row.inviterDisplayName,
      }));
    },
    async createCollectionInvite(invite, replay) {
      const value = (
        await all(
          database,
          `${liveCollectionOwner} UPSERT { _key: @inviteKey } INSERT MERGE(@invite, @replay) UPDATE {} IN collectionInvites RETURN NEW`,
          {
            scopeKey: invite.scopeKey,
            collectionKey: invite.collectionKey,
            ownerKey: invite.invitedByKey,
            inviteKey: invite.key,
            invite: toArangoDoc(invite),
            replay,
          },
        )
      )[0] as Record<string, unknown> | undefined;
      return value
        ? {
            invite: parse(collectionInviteSchema, value),
            requestHash: String(value.requestHash),
            responseCiphertext: String(value.responseCiphertext),
          }
        : null;
    },
    acceptCollectionInvite(scopeKey, inviteKey, actorKey, memberKey, now) {
      return transaction(
        {
          read: ["users", "userOrganizations", "collections", "scopes"],
          write: ["collectionInvites", "collectionMembers"],
        },
        async (tx) => {
          const inviteValue = (
            await all(
              tx,
              'LET recipientMembership = DOCUMENT(userOrganizations, @actorKey) LET recipient = recipientMembership == null ? null : DOCUMENT(users, recipientMembership.userId) LET invite = DOCUMENT(collectionInvites, @inviteKey) LET scope = invite == null ? null : DOCUMENT(scopes, invite.scopeKey) LET collection = invite == null ? null : DOCUMENT(collections, invite.collectionKey) LET inviter = invite == null ? null : FIRST(FOR owner IN collectionMembers FILTER owner.scopeKey == invite.scopeKey && owner.collectionKey == invite.collectionKey && owner.memberKey == invite.invitedByKey && owner.role == "owner" LIMIT 1 RETURN owner) FILTER invite != null && invite.scopeKey == @scopeKey && invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null && (invite.expiresAt == null || invite.expiresAt > @now) FILTER invite.inviteeKey == @actorKey || (invite.email != null && recipient != null && invite.email == LOWER(recipient.email)) FILTER recipientMembership != null && recipientMembership.status == "active" && scope != null && recipientMembership.organizationId == scope.organizationKey FILTER collection != null && collection.scopeKey == invite.scopeKey && inviter != null RETURN invite',
              { scopeKey, inviteKey, actorKey, now },
            )
          )[0];
          if (!inviteValue) return null;
          const invite = parse(collectionInviteSchema, inviteValue);
          const requestedRole =
            invite.role === "viewer" ? "viewer" : "collaborator";
          const saved = (
            await all(
              tx,
              'UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @actorKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @actorKey, role: @requestedRole, createdAt: @now } UPDATE { role: OLD.role == "owner" || OLD.role == "collaborator" ? OLD.role : @requestedRole } IN collectionMembers RETURN NEW',
              {
                scopeKey: invite.scopeKey,
                collectionKey: invite.collectionKey,
                actorKey,
                memberKey,
                requestedRole,
                now,
              },
            )
          )[0];
          if (!saved) return null;
          const finalized = (
            await all(
              tx,
              "FOR invite IN collectionInvites FILTER invite._key == @inviteKey && invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null UPDATE invite WITH { acceptedAt: @now, updatedAt: @now } IN collectionInvites RETURN true",
              { inviteKey, now },
            )
          )[0];
          if (!finalized)
            throw new Error("Invite acceptance could not be finalized.");
          return parse(collectionMemberSchema, saved);
        },
      );
    },
    async rejectCollectionInvite(scopeKey, inviteKey, actorKey, now) {
      const value = (
        await all(
          database,
          "LET membership = DOCUMENT(userOrganizations, @actorKey) LET user = membership == null ? null : DOCUMENT(users, membership.userId) FOR invite IN collectionInvites FILTER invite._key == @inviteKey && invite.scopeKey == @scopeKey FILTER invite.inviteeKey == @actorKey || invite.email == LOWER(user.email) FILTER invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null UPDATE invite WITH { rejectedAt: @now, updatedAt: @now } IN collectionInvites RETURN OLD.collectionKey",
          { scopeKey, inviteKey, actorKey, now },
        )
      )[0];
      return typeof value === "string" ? value : null;
    },
    async revokeCollectionInvite(
      scopeKey,
      collectionKey,
      inviteKey,
      ownerKey,
      now,
    ) {
      return Boolean(
        (
          await all(
            database,
            `${liveCollectionOwner} FOR invite IN collectionInvites FILTER invite._key == @inviteKey && invite.scopeKey == @scopeKey && invite.collectionKey == @collectionKey && invite.acceptedAt == null && invite.revokedAt == null UPDATE invite WITH { revokedAt: @now, updatedAt: @now } IN collectionInvites RETURN true`,
            { scopeKey, collectionKey, inviteKey, ownerKey, now },
          )
        )[0],
      );
    },
    async updateCollectionMemberRole(
      scopeKey,
      collectionKey,
      memberKey,
      role,
      ownerKey,
    ) {
      const value = (
        await all(
          database,
          `${liveCollectionOwner} FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @memberKey && member.role != "owner" UPDATE member WITH { role: @role } IN collectionMembers RETURN NEW`,
          { scopeKey, collectionKey, memberKey, role, ownerKey },
        )
      )[0];
      return value ? parse(collectionMemberSchema, value) : null;
    },
    async removeCollectionMember(scopeKey, collectionKey, memberKey, ownerKey) {
      return Boolean(
        (
          await all(
            database,
            `${liveCollectionOwner} FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @memberKey && member.role != "owner" REMOVE member IN collectionMembers RETURN true`,
            { scopeKey, collectionKey, memberKey, ownerKey },
          )
        )[0],
      );
    },
    async leaveCollection(scopeKey, collectionKey, actorKey) {
      return Boolean(
        (
          await all(
            database,
            'LET collection = DOCUMENT(collections, @collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role != "owner" REMOVE member IN collectionMembers RETURN true',
            { scopeKey, collectionKey, actorKey },
          )
        )[0],
      );
    },
    async listCollectionShares(scopeKey, collectionKey, ownerKey) {
      return (
        (await all(
          database,
          `${liveCollectionOwner} FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "collection" && share.sourceKey == @collectionKey && IS_STRING(share.responseCiphertext) SORT share.createdAt DESC RETURN { share, responseCiphertext: share.responseCiphertext }`,
          { scopeKey, collectionKey, ownerKey },
        )) as Array<{ share: unknown; responseCiphertext: string }>
      ).map((row) => ({
        share: parse(shareSchema, row.share),
        responseCiphertext: row.responseCiphertext,
      }));
    },
    async createCollectionShare(share, ownerKey, replay) {
      const value = (
        await all(
          database,
          `${liveCollectionOwner} UPSERT { _key: @shareKey } INSERT MERGE(@share, @replay) UPDATE {} IN shares RETURN NEW`,
          {
            scopeKey: share.scopeKey,
            collectionKey: share.sourceKey,
            ownerKey,
            shareKey: share.key,
            share: toArangoDoc(share),
            replay,
          },
        )
      )[0] as Record<string, unknown> | undefined;
      return value
        ? {
            share: parse(shareSchema, value),
            requestHash: String(value.requestHash),
            responseCiphertext: String(value.responseCiphertext),
          }
        : null;
    },
    async setCollectionShareActive(
      scopeKey,
      collectionKey,
      shareKey,
      ownerKey,
      active,
      now,
    ) {
      const value = (
        await all(
          database,
          `${liveCollectionOwner} FOR share IN shares FILTER share._key == @shareKey && share.scopeKey == @scopeKey && share.sourceType == "collection" && share.sourceKey == @collectionKey && IS_STRING(share.responseCiphertext) UPDATE share WITH { revokedAt: @revokedAt, updatedAt: @now } IN shares OPTIONS { keepNull: true } RETURN { share: NEW, responseCiphertext: NEW.responseCiphertext }`,
          {
            scopeKey,
            collectionKey,
            shareKey,
            ownerKey,
            revokedAt: active ? null : now,
            now,
          },
        )
      )[0] as { share?: unknown; responseCiphertext?: unknown } | undefined;
      return value?.share && typeof value.responseCiphertext === "string"
        ? {
            share: parse(shareSchema, value.share),
            responseCiphertext: value.responseCiphertext,
          }
        : null;
    },
    activateCollectionShare(scopeKey, tokenHash, actorKey, memberKey, now) {
      return transaction(
        {
          read: ["shares", "collections", "scopes", "userOrganizations"],
          write: ["collectionMembers"],
        },
        async (tx) => {
          const value = (
            await all(
              tx,
              'LET actor = DOCUMENT(userOrganizations, @actorKey) FOR share IN shares FILTER share.scopeKey == @scopeKey && share.tokenHash == @tokenHash && share.sourceType == "collection" && share.permission IN ["viewer", "collaborator"] && share.revokedAt == null && (share.expiresAt == null || share.expiresAt > @now) LET collection = DOCUMENT(collections, share.sourceKey) LET scope = DOCUMENT(scopes, share.scopeKey) FILTER actor != null && actor.status == "active" && collection != null && collection.scopeKey == share.scopeKey && scope != null && actor.organizationId == scope.organizationKey LET requestedRole = share.permission == "collaborator" ? "collaborator" : "viewer" UPSERT { scopeKey: share.scopeKey, collectionKey: share.sourceKey, memberKey: @actorKey } INSERT { _key: @memberKey, scopeKey: share.scopeKey, collectionKey: share.sourceKey, memberKey: @actorKey, role: requestedRole, createdAt: @now } UPDATE { role: OLD.role == "owner" || OLD.role == "collaborator" ? OLD.role : requestedRole } IN collectionMembers RETURN NEW',
              { scopeKey, tokenHash, actorKey, memberKey, now },
            )
          )[0];
          return value ? parse(collectionMemberSchema, value) : null;
        },
      );
    },
    async getUserKeyByMemberKey(memberKey) {
      const value = (
        await all(
          database,
          "LET membership = DOCUMENT(userOrganizations, @memberKey) FILTER membership != null RETURN membership.userId",
          { memberKey },
        )
      )[0];
      return typeof value === "string" ? value : null;
    },
    async getInviteRecipientUserKey(inviteKey) {
      const value = (
        await all(
          database,
          'LET invite = DOCUMENT(collectionInvites, @inviteKey) FILTER invite != null LET membership = invite.inviteeKey == null ? FIRST(FOR user IN users FILTER LOWER(user.email) == invite.email FOR candidate IN userOrganizations FILTER candidate.userId == user._key && candidate.status == "active" LIMIT 1 RETURN candidate) : DOCUMENT(userOrganizations, invite.inviteeKey) FILTER membership != null RETURN membership.userId',
          { inviteKey },
        )
      )[0];
      return typeof value === "string" ? value : null;
    },
    async listCollectionUserKeys(collectionKey) {
      return (await all(
        database,
        'FOR member IN collectionMembers FILTER member.collectionKey == @collectionKey LET membership = DOCUMENT(userOrganizations, member.memberKey) FILTER membership != null && membership.status == "active" RETURN DISTINCT membership.userId',
        { collectionKey },
      )) as string[];
    },
    async listScopeManagerUserKeys(scopeKey) {
      return (await all(
        database,
        'LET scope = DOCUMENT(scopes, @scopeKey) FILTER scope != null FOR membership IN userOrganizations FILTER membership.organizationId == scope.organizationKey && membership.status == "active" LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] RETURN DISTINCT membership.userId',
        { scopeKey },
      )) as string[];
    },
    listRedundantCollectionImages: (scopeKey, collectionKey) =>
      redundantCollectionImages(database, scopeKey, collectionKey),
    deleteDuplicateImages(scopeKey, collectionKey, imageKeys, actorKey, now) {
      return transaction(
        {
          read: [
            "imageCaptions",
            "visualIdentities",
            "userOrganizations",
            "scopes",
            "scopeMembers",
            "collectionMembers",
          ],
          write: [
            "images",
            "imageCaptions",
            "collectionImages",
            "placeImages",
            "collections",
            "imageIdentities",
            "imageCollecitionHightlights",
            "imageCollectionMemories",
            "trips",
            "tagAssignments",
            "shares",
            "userHiddens",
            "storageDeletionJobs",
          ],
        },
        async (tx) => {
          const owner = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionOwner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || collectionOwner != null RETURN true',
            { scopeKey, collectionKey, actorKey },
          );
          if (!owner.length) return null;
          const duplicates = await redundantCollectionImages(
            tx,
            scopeKey,
            collectionKey,
          );
          const allowed = new Set(duplicates.map(({ key }) => key));
          if (imageKeys.some((key) => !allowed.has(key))) return null;
          const favoriteKeys = new Set(
            duplicates
              .filter(({ isFavorite }) => isFavorite)
              .map(({ key }) => key),
          );
          const favoriteImageKeys = imageKeys.filter((key) =>
            favoriteKeys.has(key),
          );
          const removedImageKeys = imageKeys.filter(
            (key) => !favoriteKeys.has(key),
          );
          if (removedImageKeys.length === 0)
            return {
              removedImageKeys,
              deletedImageKeys: [],
              favoriteImageKeys,
              collectionKeys: [],
              memoryCollectionKeys: [],
              subjectChanged: false,
              storageKeys: [],
            };
          const memoryRelations = (await all(
            tx,
            "FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN @imageKeys LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == memory.imageKey RETURN DISTINCT relation.collectionKey) RETURN { imageKey: memory.imageKey, collectionKeys }",
            { scopeKey, imageKeys: removedImageKeys },
          )) as Array<{ imageKey: string; collectionKeys: string[] }>;
          await tx.query(
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages",
            { imageKeys: removedImageKeys, scopeKey, collectionKey },
          );
          await tx.query(
            "FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections",
            { imageKeys: removedImageKeys, scopeKey, collectionKey, now },
          );
          const deletedRows = (await all(
            tx,
            "FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey LET collectionCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LIMIT 1 RETURN 1) LET subjectCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LIMIT 1 RETURN 1) FILTER collectionCount == 0 && subjectCount == 0 RETURN { imageKey: image._key, storageKey: image.storageKey, imageCaptionKey: image.imageCaptionKey }",
            { imageKeys: removedImageKeys, scopeKey },
          )) as Array<{
            imageKey: string;
            storageKey: string;
            imageCaptionKey?: string | null;
          }>;
          for (const { storageKey } of deletedRows)
            await tx.query(
              "UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs",
              { storageKey, now },
            );
          const deleted = new Set(deletedRows.map(({ imageKey }) => imageKey));
          const deletedImageKeys = removedImageKeys.filter((key) =>
            deleted.has(key),
          );
          const memoryCollectionKeys = [
            ...new Set(
              memoryRelations
                .filter(({ imageKey }) => deleted.has(imageKey))
                .flatMap(({ collectionKeys }) => collectionKeys),
            ),
          ];
          await tx.query(
            "FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN @imageKeys REMOVE memory IN imageCollectionMemories",
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query("FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey IN @imageKeys UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }", { scopeKey, imageKeys: deletedImageKeys, now });
          await tx.query(
            "FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey REMOVE image IN images",
            { imageKeys: deletedImageKeys, scopeKey },
          );
          await tx.query(
            "FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, @imageKeys)) > 0 UPDATE highlight WITH { imageKeys: MINUS(highlight.imageKeys, @imageKeys), updatedAt: @now } IN imageCollecitionHightlights",
            { scopeKey, imageKeys: removedImageKeys, now },
          );
          await tx.query(
            'FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey IN @imageKeys REMOVE assignment IN tagAssignments',
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query(
            'FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey IN @imageKeys REMOVE share IN shares',
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query(
            'FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN @imageKeys REMOVE hidden IN userHiddens',
            { imageKeys: deletedImageKeys },
          );
          await tx.query(
            "FOR captionKey IN @captionKeys FILTER captionKey != null FILTER LENGTH(FOR image IN images FILTER image.imageCaptionKey == captionKey LIMIT 1 RETURN 1) == 0 FOR caption IN imageCaptions FILTER caption._key == captionKey REMOVE caption IN imageCaptions",
            {
              captionKeys: deletedRows.map(
                ({ imageCaptionKey }) => imageCaptionKey ?? null,
              ),
            },
          );
          return {
            removedImageKeys,
            deletedImageKeys,
            favoriteImageKeys,
            collectionKeys: [collectionKey],
            memoryCollectionKeys,
            subjectChanged: false,
            storageKeys: deletedRows.map(({ storageKey }) => storageKey),
          };
        },
      );
    },
    deleteImages(scopeKey, imageKeys, actorKey, now) {
      return transaction(
        {
          read: [
            "images",
            "userOrganizations",
            "scopes",
            "scopeMembers",
            "collectionMembers",
          ],
          write: [
            "images",
            "imageCaptions",
            "collectionImages",
            "placeImages",
            "collections",
            "imageIdentities",
            "visualIdentities",
            "imageCollectionMemories",
            "trips",
            "imageCollecitionHightlights",
            "tagAssignments",
            "shares",
            "userHiddens",
            "storageDeletionJobs",
          ],
        },
        async (tx) => {
          const existing = (await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy != "system-only" LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey RETURN 1) LET roles = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey RETURN member.role) FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || "owner" IN roles || (image.createdByKey == @actorKey && (relationCount == 0 || "collaborator" IN roles || "member" IN roles)) RETURN { imageKey, isFavorite: image.isFavorite == true }',
            { scopeKey, imageKeys, actorKey },
          )) as Array<{ imageKey: string; isFavorite: boolean }>;
          if (existing.length !== imageKeys.length) return null;
          const favoriteKeys = new Set(
            existing
              .filter(({ isFavorite }) => isFavorite)
              .map(({ imageKey }) => imageKey),
          );
          const favoriteImageKeys = imageKeys.filter((key) =>
            favoriteKeys.has(key),
          );
          const deletedImageKeys = imageKeys.filter(
            (key) => !favoriteKeys.has(key),
          );
          if (deletedImageKeys.length === 0)
            return {
              deletedImageKeys,
              favoriteImageKeys,
              collectionKeys: [],
              memoryCollectionKeys: [],
              subjectChanged: false,
              hadUnfiledImages: false,
              storageKeys: [],
            };
          const collectionKeys = (await all(
            tx,
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN @imageKeys RETURN DISTINCT relation.collectionKey",
            { scopeKey, imageKeys: deletedImageKeys },
          )) as string[];
          const memoryCollectionKeys = (await all(
            tx,
            "FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN @imageKeys FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == memory.imageKey RETURN DISTINCT relation.collectionKey",
            { scopeKey, imageKeys: deletedImageKeys },
          )) as string[];
          const hadUnfiledImages = Boolean(
            (
              await all(
                tx,
                "FOR imageKey IN @imageKeys FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey LIMIT 1 RETURN 1) == 0 LIMIT 1 RETURN true",
                { scopeKey, imageKeys: deletedImageKeys },
              )
            )[0],
          );
          const subjectChanged = Boolean(
            (
              await all(
                tx,
                "FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey IN @imageKeys LIMIT 1 RETURN true",
                { scopeKey, imageKeys: deletedImageKeys },
              )
            )[0],
          );
          await tx.query(
            "FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections",
            { scopeKey, imageKeys: deletedImageKeys, now },
          );
          await tx.query(
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages",
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query("FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN @imageKeys REMOVE relation IN placeImages", { scopeKey, imageKeys: deletedImageKeys });
          await tx.query(
            "FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN @imageKeys REMOVE memory IN imageCollectionMemories",
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query("FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey IN @imageKeys UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }", { scopeKey, imageKeys: deletedImageKeys, now });
          await tx.query(
            "FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey IN @imageKeys REMOVE relation IN imageIdentities",
            { scopeKey, imageKeys: deletedImageKeys },
          );
          const removedIdentityKeys = (await all(
            tx,
            "FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.referenceImageKey IN @imageKeys LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key && relation.imageKey NOT IN @imageKeys LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey SORT relation.isReference DESC, relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement == null REMOVE identity IN visualIdentities RETURN OLD._key",
            { scopeKey, imageKeys: deletedImageKeys },
          )) as string[];
          await tx.query(
            "FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey IN @identityKeys REMOVE relation IN imageIdentities",
            { scopeKey, identityKeys: removedIdentityKeys },
          );
          await tx.query(
            "FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.referenceImageKey IN @imageKeys LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key && relation.imageKey NOT IN @imageKeys LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey SORT relation.isReference DESC, relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement != null UPDATE identity WITH { referenceImageKey: replacement, updatedAt: @now } IN visualIdentities",
            { scopeKey, imageKeys: deletedImageKeys, now },
          );
          await tx.query(
            "FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey LET identity = DOCUMENT(visualIdentities, relation.identityKey) FILTER identity != null && identity.scopeKey == @scopeKey UPDATE relation WITH { isReference: relation.imageKey == identity.referenceImageKey } IN imageIdentities",
            { scopeKey },
          );
          await tx.query(
            "FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, @imageKeys)) > 0 UPDATE highlight WITH { imageKeys: MINUS(highlight.imageKeys, @imageKeys), updatedAt: @now } IN imageCollecitionHightlights",
            { scopeKey, imageKeys: deletedImageKeys, now },
          );
          await tx.query(
            'FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey IN @imageKeys REMOVE assignment IN tagAssignments',
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query(
            'FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey IN @imageKeys REMOVE share IN shares',
            { scopeKey, imageKeys: deletedImageKeys },
          );
          await tx.query(
            'FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN @imageKeys REMOVE hidden IN userHiddens',
            { imageKeys: deletedImageKeys },
          );
          const deletedRows = (await all(
            tx,
            "FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey RETURN { imageKey: image._key, storageKey: image.storageKey, imageCaptionKey: image.imageCaptionKey }",
            { scopeKey, imageKeys: deletedImageKeys },
          )) as Array<{
            imageKey: string;
            storageKey: string;
            imageCaptionKey?: string | null;
          }>;
          for (const { storageKey } of deletedRows)
            await tx.query(
              "UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs",
              { storageKey, now },
            );
          await tx.query(
            "FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey REMOVE image IN images",
            {
              imageKeys: deletedRows.map(({ imageKey }) => imageKey),
              scopeKey,
            },
          );
          await tx.query(
            "FOR captionKey IN @captionKeys FILTER captionKey != null FILTER LENGTH(FOR image IN images FILTER image.imageCaptionKey == captionKey LIMIT 1 RETURN 1) == 0 FOR caption IN imageCaptions FILTER caption._key == captionKey REMOVE caption IN imageCaptions",
            {
              captionKeys: deletedRows.map(
                ({ imageCaptionKey }) => imageCaptionKey ?? null,
              ),
            },
          );
          return {
            deletedImageKeys,
            favoriteImageKeys,
            collectionKeys,
            memoryCollectionKeys,
            subjectChanged,
            hadUnfiledImages,
            storageKeys: deletedRows.map(({ storageKey }) => storageKey),
          };
        },
      );
    },
    transferCollectionImages(input) {
      return transaction(
        {
          read: [
            "images",
            "collectionMembers",
            "userOrganizations",
            "scopes",
            "scopeMembers",
          ],
          write: ["collections", "collectionImages"],
        },
        async (tx) => {
          const source = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET sourceCollection = DOCUMENT(collections, @sourceCollectionKey) LET scopeRole = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @actorKey && item.status == "active" LIMIT 1 RETURN item.role) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && sourceCollection != null && sourceCollection.scopeKey == @scopeKey && sourceCollection.mutationPolicy != "system-only" LET elevated = actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) LET relation = FIRST(FOR candidate IN collectionImages FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @sourceCollectionKey && candidate.imageKey == imageKey LIMIT 1 RETURN candidate) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @sourceCollectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy != "system-only" && relation != null FILTER elevated || member != null && (member.role == "owner" || (member.role IN ["collaborator", "member"] && image.createdByKey == @actorKey)) RETURN imageKey',
            {
              imageKeys: input.imageKeys,
              scopeKey: input.scopeKey,
              sourceCollectionKey: input.sourceCollectionKey,
              actorKey: input.actorKey,
            },
          );
          if (source.length !== input.imageKeys.length)
            return { status: "selection-changed" as const };
          const destinations = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeRole = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @actorKey && item.status == "active" LIMIT 1 RETURN item.role) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey LET elevated = actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] FOR collectionKey IN @collectionKeys LET collection = DOCUMENT(collections, collectionKey) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" FILTER elevated || member != null && member.role IN ["owner", "collaborator", "member"] RETURN collectionKey',
            {
              collectionKeys: input.destinationCollectionKeys,
              scopeKey: input.scopeKey,
              actorKey: input.actorKey,
            },
          );
          if (destinations.length !== input.destinationCollectionKeys.length)
            return { status: "destination-forbidden" as const };
          let createdRelationCount = 0;
          for (const collectionKey of input.destinationCollectionKeys)
            for (const imageKey of input.imageKeys) {
              const relation = collectionImageSchema.parse({
                key: newId(),
                scopeKey: input.scopeKey,
                collectionKey,
                imageKey,
                addedByKey: input.actorKey,
                createdAt: input.now,
              });
              const created = await all(
                tx,
                "UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages RETURN OLD == null",
                {
                  scopeKey: input.scopeKey,
                  collectionKey,
                  imageKey,
                  relation: toArangoDoc(relation),
                },
              );
              if (created[0] === true) createdRelationCount += 1;
            }
          if (input.mode === "move") {
            await tx.query(
              "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @sourceCollectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages",
              {
                scopeKey: input.scopeKey,
                sourceCollectionKey: input.sourceCollectionKey,
                imageKeys: input.imageKeys,
              },
            );
            await tx.query(
              "FOR collection IN collections FILTER collection._key == @sourceCollectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections",
              {
                scopeKey: input.scopeKey,
                sourceCollectionKey: input.sourceCollectionKey,
                imageKeys: input.imageKeys,
                now: input.now,
              },
            );
          }
          return {
            status: "ok" as const,
            createdRelationCount,
            collectionKeys: [
              input.sourceCollectionKey,
              ...input.destinationCollectionKeys,
            ],
          };
        },
      );
    },
    insertUploads(uploads) {
      return transaction(
        { read: [], write: ["galleryUploads"] },
        async (tx) => {
          for (const upload of uploads)
            await tx.query("INSERT @upload INTO galleryUploads", {
              upload: toArangoDoc(galleryUploadSchema.parse(upload)),
            });
          return uploads;
        },
      );
    },
    getUpload: getGalleryUploadById,
    recoverUploadQueue(staleBefore, now) {
      return transaction(
        {
          read: ["images", "visualIdentities"],
          write: [
            "galleryUploads",
            "images",
            "imageCaptions",
            "collectionImages",
            "collections",
            "imageIdentities",
            "visualIdentities",
            "imageCollectionMemories",
            "trips",
          ],
        },
        async (tx) => {
          const stale = (await all(
            tx,
            'FOR upload IN galleryUploads FILTER upload.status == "processing" && upload.updatedAt < @staleBefore SORT upload.updatedAt ASC, upload._key ASC RETURN { key: upload._key, scopeKey: upload.scopeKey, leaseId: upload.processingLeaseId || null }',
            { staleBefore },
          )) as Array<{
            key: string;
            scopeKey: string;
            leaseId: string | null;
          }>;
          const storageKeys: string[] = [];
          for (const upload of stale) {
            const effects = await compensateProcessingUpload(
              tx,
              upload.key,
              upload.scopeKey,
              upload.leaseId,
              "UPLOAD_PROCESSING_LEASE_EXPIRED",
              "queued",
              now,
            );
            if (effects) storageKeys.push(...effects.storageKeys);
          }
          const queued = await all(
            tx,
            'FOR upload IN galleryUploads FILTER upload.status == "queued" SORT upload.updatedAt ASC, upload._key ASC RETURN upload',
            {},
          );
          return {
            uploads: queued.map((value) => parse(galleryUploadSchema, value)),
            storageKeys,
          };
        },
      );
    },
    updateUpload: updateGalleryUpload,
    queueUploads(input) {
      return transaction(
        { read: ["collections"], write: ["galleryUploads"] },
        async (tx) => {
          const rows = await all(
            tx,
            'FOR uploadKey IN @uploadKeys LET upload = DOCUMENT(galleryUploads, uploadKey) LET collection = upload == null || upload.collectionKey == null ? null : DOCUMENT(collections, upload.collectionKey) FILTER upload != null && upload.organizationKey == @organizationKey && upload.scopeKey == @scopeKey && upload.actorKey == @actorKey && upload.status == "reserved" && upload.expiresAt > @now FILTER upload.collectionKey == null || (collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only") RETURN upload',
            input,
          );
          if (rows.length !== input.uploadKeys.length) return null;
          const updated = await all(
            tx,
            'FOR uploadKey IN @uploadKeys UPDATE uploadKey WITH { status: "queued", processingLeaseId: null, errorCode: null, updatedAt: @now } IN galleryUploads RETURN NEW',
            input,
          );
          return updated.map((value) => parse(galleryUploadSchema, value));
        },
      );
    },
    claimUploads(uploadKeys, leaseId, now) {
      return transaction(
        { read: [], write: ["galleryUploads"] },
        async (tx) => {
          const claimed = await all(
            tx,
            'FOR uploadKey IN @uploadKeys LET upload = DOCUMENT(galleryUploads, uploadKey) FILTER upload != null && upload.status == "queued" UPDATE upload WITH { status: "processing", processingLeaseId: @leaseId, errorCode: null, updatedAt: @now } IN galleryUploads RETURN NEW',
            { uploadKeys, leaseId, now },
          );
          return claimed.map((value) => parse(galleryUploadSchema, value));
        },
      );
    },
    async renewUploadLease(uploadKeys, leaseId, now) {
      return (
        await all(
          database,
          'FOR uploadKey IN @uploadKeys LET upload = DOCUMENT(galleryUploads, uploadKey) FILTER upload != null && upload.status == "processing" && upload.processingLeaseId == @leaseId UPDATE upload WITH { updatedAt: @now } IN galleryUploads RETURN true',
          { uploadKeys, leaseId, now },
        )
      ).length;
    },
    finalizeUpload(upload, relation, leaseId, now, failureStatus, errorCode) {
      return transaction(
        {
          read: [
            "images",
            "scopes",
            "userOrganizations",
            "scopeMembers",
            "collections",
            "collectionMembers",
            "visualIdentities",
          ],
          write: [
            "galleryUploads",
            "images",
            "collectionImages",
            "collections",
            "imageIdentities",
            "visualIdentities",
            "imageCaptions",
            "imageCollectionMemories",
            "trips",
          ],
        },
        async (tx) => {
          const allowed = await all(
            tx,
            'LET current = DOCUMENT(galleryUploads, @uploadKey) LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET image = DOCUMENT(images, @imageKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET manager = actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] LET collection = @collectionKey == null ? null : DOCUMENT(collections, @collectionKey) LET member = @collectionKey == null ? null : FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER current != null && current.status == "processing" && current.processingLeaseId == @leaseId && current.scopeKey == @scopeKey && current.actorKey == @actorKey && current.imageKey == @imageKey FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey FILTER image != null && image.scopeKey == @scopeKey && image.createdByKey == @actorKey FILTER @collectionKey == null ? manager : (collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && (manager || member.role IN ["owner", "collaborator", "member"])) RETURN true',
            {
              uploadKey: upload.key,
              scopeKey: upload.scopeKey,
              actorKey: upload.actorKey,
              imageKey: upload.imageKey,
              collectionKey: upload.collectionKey ?? null,
              leaseId,
            },
          );
          if (!allowed.length) {
            const effects = await compensateProcessingUpload(
              tx,
              upload.key,
              upload.scopeKey,
              leaseId,
              errorCode,
              failureStatus,
              now,
            );
            return effects
              ? { status: "compensated" as const, effects }
              : { status: "unchanged" as const };
          }
          if (relation)
            await tx.query(
              "UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages",
              {
                scopeKey: relation.scopeKey,
                collectionKey: relation.collectionKey,
                imageKey: relation.imageKey,
                relation: toArangoDoc(relation),
              },
            );
          const completed = await all(
            tx,
            'FOR current IN galleryUploads FILTER current._key == @uploadKey && current.status == "processing" && current.processingLeaseId == @leaseId UPDATE current WITH { status: "completed", processingLeaseId: null, errorCode: null, updatedAt: @now } IN galleryUploads RETURN true',
            { uploadKey: upload.key, leaseId, now },
          );
          if (!completed.length)
            throw new Error("Gallery upload completion lost compare-and-set.");
          return { status: "completed" as const };
        },
      );
    },
    compensateUpload(uploadKey, scopeKey, leaseId, errorCode, status, now) {
      return transaction(
        {
          read: ["images", "visualIdentities"],
          write: [
            "galleryUploads",
            "images",
            "imageCaptions",
            "collectionImages",
            "collections",
            "imageIdentities",
            "visualIdentities",
            "imageCollectionMemories",
            "trips",
          ],
        },
        (tx) =>
          compensateProcessingUpload(
            tx,
            uploadKey,
            scopeKey,
            leaseId,
            errorCode,
            status,
            now,
          ),
      );
    },
    async canFinalizeUpload(upload) {
      return Boolean(
        (
          await all(
            database,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey LET elevated = actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] LET collection = @collectionKey == null ? null : DOCUMENT(collections, @collectionKey) LET member = @collectionKey == null ? null : FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER @collectionKey == null ? elevated : (collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && (elevated || member.role IN ["owner", "collaborator", "member"])) RETURN true',
            {
              scopeKey: upload.scopeKey,
              collectionKey: upload.collectionKey ?? null,
              actorKey: upload.actorKey,
            },
          )
        )[0],
      );
    },
    searchAccessibleImages: (input) => searchAccessibleImages(input, database),
    async listMatchingIdentityNames(scopeKey, query, actorKey) {
      return (
        await all(
          database,
          "FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey FILTER CONTAINS(LOWER(@query), LOWER(identity.name)) RETURN identity",
          { scopeKey, query, actorKey },
        )
      ).map((value) => parse(visualIdentitySchema, value));
    },
    async listIdentityMatches(scopeKey, embedding, actorKey) {
      return (await all(
        database,
        "FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey FILTER IS_ARRAY(identity.embedding) && LENGTH(identity.embedding) == @dimensions LET confidence = COSINE_SIMILARITY(identity.embedding, @embedding) FILTER IS_NUMBER(confidence) && confidence >= 0.82 RETURN { identityKey: identity._key, confidence }",
        { scopeKey, actorKey, embedding, dimensions: embedding.length },
      )) as Array<{ identityKey: string; confidence: number }>;
    },
    async persistIdentityMatches(scopeKey, identityKey, matches) {
      if (!matches.length) return false;
      const now = new Date().toISOString();
      return transaction(["imageIdentities"], async (tx) => {
        let changed = false;
        for (const match of matches) {
          const relation = imageIdentitySchema.parse({
            key: newId(),
            scopeKey,
            imageKey: match.imageKey,
            identityKey,
            confidence: match.confidence,
            isReference: false,
            createdAt: now,
          });
          const result = await all(
            tx,
            "UPSERT { scopeKey: @scopeKey, identityKey: @identityKey, imageKey: @imageKey } INSERT @relation UPDATE { confidence: MAX([OLD.confidence, @confidence]) } IN imageIdentities RETURN OLD == null || NEW.confidence != OLD.confidence",
            {
              scopeKey,
              identityKey,
              imageKey: match.imageKey,
              confidence: match.confidence,
              relation: toArangoDoc(relation),
            },
          );
          changed ||= result[0] === true;
        }
        return changed;
      });
    },
    async setImageFavorite(scopeKey, imageKey, actorKey, isFavorite, now) {
      const value = await all(
        database,
        'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET image = DOCUMENT(images, @imageKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN DISTINCT relation.collectionKey) LET roles = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey RETURN member.role) LET relationCount = LENGTH(collectionKeys) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && image != null && image.scopeKey == @scopeKey && image.mutationPolicy != "system-only" FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || "owner" IN roles || (image.createdByKey == @actorKey && (relationCount == 0 || "collaborator" IN roles || "member" IN roles)) UPDATE image WITH { isFavorite: @isFavorite, updatedAt: @now } IN images RETURN { image: NEW, collectionKeys }',
        { scopeKey, imageKey, actorKey, isFavorite, now },
      );
      const row = value[0] as
        | { image?: unknown; collectionKeys?: unknown }
        | undefined;
      return row?.image && Array.isArray(row.collectionKeys)
        ? {
            image: parse(imageSchema, row.image),
            collectionKeys: row.collectionKeys as string[],
          }
        : null;
    },
    async updateImageDetails(
      scopeKey,
      imageKey,
      actorKey,
      filename,
      isFavorite,
      embedding,
      now,
    ) {
      const value = await all(
        database,
        'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET image = DOCUMENT(images, @imageKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN DISTINCT relation.collectionKey) LET roles = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey RETURN member.role) LET relationCount = LENGTH(collectionKeys) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && image != null && image.scopeKey == @scopeKey && image.mutationPolicy != "system-only" FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || "owner" IN roles || (image.createdByKey == @actorKey && (relationCount == 0 || "collaborator" IN roles || "member" IN roles)) UPDATE image WITH { filename: @filename, isFavorite: @isFavorite, embedding: @embedding, updatedAt: @now } IN images RETURN { image: NEW, collectionKeys }',
        { scopeKey, imageKey, actorKey, filename, isFavorite, embedding, now },
      );
      const row = value[0] as
        | { image?: unknown; collectionKeys?: unknown }
        | undefined;
      return row?.image && Array.isArray(row.collectionKeys)
        ? {
            image: parse(imageSchema, row.image),
            collectionKeys: row.collectionKeys as string[],
          }
        : null;
    },
    async updateCollectionDetails(
      scopeKey,
      collectionKey,
      actorKey,
      name,
      isFavorite,
      coverImageKey,
      embedding,
      now,
    ) {
      const value = await all(
        database,
        'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) LET cover = @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey) LET related = @coverImageKey == null ? null : FIRST(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == @coverImageKey LIMIT 1 RETURN relation) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null FILTER !@setCover || @coverImageKey == null || (cover != null && cover.scopeKey == @scopeKey && related != null) UPDATE collection WITH MERGE({ name: @name, isFavorite: @isFavorite, embedding: @embedding, updatedAt: @now }, @setCover ? { coverImageKey: @coverImageKey } : {}) IN collections OPTIONS { keepNull: false } RETURN NEW',
        {
          scopeKey,
          collectionKey,
          actorKey,
          name,
          isFavorite,
          coverImageKey: coverImageKey ?? null,
          setCover: coverImageKey !== undefined,
          embedding,
          now,
        },
      );
      return value[0] ? parse(collectionSchema, value[0]) : null;
    },
    async deleteCollection(scopeKey, collectionKey, actorKey, now) {
      if (!await userMutableCollection(database, scopeKey, collectionKey)) return null;
      return transaction(
        {
          read: ["scopes", "userOrganizations", "scopeMembers"],
          write: [
            "collections",
            "collectionImages",
            "collectionMembers",
            "collectionInvites",
            "imageCollecitionHightlights",
            "tripAttachments",
            "trips",
            "tagAssignments",
            "shares",
            "userHiddens",
          ],
        },
        async (tx) => {
          const rows = (await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null LET formerUserKeys = (FOR membership IN userOrganizations FILTER membership.organizationId == scope.organizationKey && membership.status == "active" LET managerRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role) LET collectionMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == membership._key LIMIT 1 RETURN member) FILTER membership.orgRole IN ["owner", "admin"] || managerRole IN ["owner", "admin", "moderator"] || collectionMember != null RETURN DISTINCT membership.userId) RETURN { isFavorite: collection.isFavorite == true, formerUserKeys }',
            { scopeKey, collectionKey, actorKey },
          )) as Array<{ isFavorite: boolean; formerUserKeys: string[] }>;
          const loaded = rows[0];
          if (!loaded) return null;
          if (loaded.isFavorite) return { status: "favorite" as const };
          const affectedTripKeys = await all(tx, 'FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.targetType == "collection" && attachment.targetKey == @collectionKey RETURN DISTINCT attachment.tripKey', { scopeKey, collectionKey }) as string[];
          await tx.query(
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey REMOVE relation IN collectionImages",
            { scopeKey, collectionKey },
          );
          await tx.query(
            "FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey REMOVE member IN collectionMembers",
            { scopeKey, collectionKey },
          );
          await tx.query(
            "FOR invite IN collectionInvites FILTER invite.scopeKey == @scopeKey && invite.collectionKey == @collectionKey REMOVE invite IN collectionInvites",
            { scopeKey, collectionKey },
          );
          await tx.query(
            "FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && highlight.collectionKey == @collectionKey REMOVE highlight IN imageCollecitionHightlights",
            { scopeKey, collectionKey },
          );
          await tx.query(
            'FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.targetType == "collection" && attachment.targetKey == @collectionKey REMOVE attachment IN tripAttachments',
            { scopeKey, collectionKey },
          );
          await tx.query('FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip._key IN @tripKeys UPDATE trip WITH { updatedAt: @now } IN trips', { scopeKey, tripKeys: affectedTripKeys, now });
          await tx.query(
            'FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "collection" && assignment.sourceKey == @collectionKey REMOVE assignment IN tagAssignments',
            { scopeKey, collectionKey },
          );
          await tx.query(
            'FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "collection" && share.sourceKey == @collectionKey REMOVE share IN shares',
            { scopeKey, collectionKey },
          );
          await tx.query(
            'FOR hidden IN userHiddens FILTER hidden.source == "collection" && hidden.sourceKey == @collectionKey REMOVE hidden IN userHiddens',
            { collectionKey },
          );
          await tx.query(
            "FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey REMOVE collection IN collections",
            { scopeKey, collectionKey },
          );
          return {
            status: "deleted" as const,
            formerUserKeys: loaded.formerUserKeys,
          };
        },
      );
    },
    listSubjects: (scopeKey, actorKey) =>
      subjectRows(
        "FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null RETURN 1) SORT identity.name ASC, identity._key ASC RETURN { identity, reference, imageCount }",
        { scopeKey, actorKey },
      ),
    async getSubject(scopeKey, identityKey, actorKey) {
      return (
        (
          await subjectRows(
            "FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null RETURN 1) LIMIT 1 RETURN { identity, reference, imageCount }",
            { scopeKey, identityKey, actorKey },
          )
        )[0] ?? null
      );
    },
    createSubject(identity, relations, referenceImageKeys, actorKey) {
      return transaction(
        {
          read: ["images", "scopes", "userOrganizations", "scopeMembers"],
          write: ["visualIdentities", "imageIdentities"],
        },
        async (tx) => {
          const references = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey FILTER actor.orgRole IN ["owner", "admin"] || scopeMember.role IN ["owner", "admin", "moderator"] FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey && image.createdByKey == @actorKey && image.mutationPolicy != "system-only" RETURN image._key',
            {
              imageKeys: referenceImageKeys,
              scopeKey: identity.scopeKey,
              actorKey,
            },
          );
          if (
            identity.createdByKey !== actorKey ||
            references.length !== referenceImageKeys.length
          )
            return false;
          await tx.query("INSERT @identity INTO visualIdentities", {
            identity: toArangoDoc(identity),
          });
          for (const relation of relations)
            await tx.query("INSERT @relation INTO imageIdentities", {
              relation: toArangoDoc(relation),
            });
          return true;
        },
      );
    },
    async listSubjectImages(scopeKey, identityKey, actorKey, collectionKey) {
      return (
        (await all(
          database,
          "LET identity = DOCUMENT(visualIdentities, @identityKey) FILTER identity != null && identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == @identityKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey FILTER @collectionKey == null || LENGTH(FOR collectionImage IN collectionImages FILTER collectionImage.scopeKey == @scopeKey && collectionImage.collectionKey == @collectionKey && collectionImage.imageKey == image._key LIMIT 1 RETURN 1) > 0 SORT relation.confidence DESC, image.createdAt DESC RETURN { image, confidence: relation.confidence }",
          {
            scopeKey,
            identityKey,
            actorKey,
            collectionKey: collectionKey ?? null,
          },
        )) as Array<{ image: unknown; confidence: number }>
      ).map((row) => ({
        image: parse(imageSchema, row.image),
        confidence: row.confidence,
      }));
    },
    deleteSubject(scopeKey, identityKey, actorKey) {
      return transaction(
        {
          read: ["scopes", "userOrganizations", "scopeMembers"],
          write: ["visualIdentities", "imageIdentities"],
        },
        async (tx) => {
          const removed = Boolean(
            (
              await all(
                tx,
                'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey FILTER actor.orgRole IN ["owner", "admin"] || scopeMember.role IN ["owner", "admin", "moderator"] FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey LIMIT 1 REMOVE identity IN visualIdentities RETURN OLD._key',
                { identityKey, scopeKey, actorKey },
              )
            )[0],
          );
          if (removed)
            await tx.query(
              "FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == @identityKey REMOVE relation IN imageIdentities",
              { scopeKey, identityKey },
            );
          return removed;
        },
      );
    },
    async listHighlightCandidates(scopeKey, collectionKey, actorKey) {
      if (!await userMutableCollection(database, scopeKey, collectionKey)) return null;
      const row = (
        (await all(
          database,
          'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || collectionMember.role == "owner" LET candidates = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey) LET qualityScore = caption != null && caption.scopeKey == @scopeKey && IS_NUMBER(caption.score) && caption.score >= 1 && caption.score <= 100 ? caption.score : 1 SORT relation.createdAt ASC, relation._key ASC RETURN { image, qualityScore }) RETURN candidates',
          { scopeKey, collectionKey, actorKey },
        )) as Array<Array<{ image: unknown; qualityScore: number }>>
      )[0];
      return row
        ? row.map((candidate) => ({
            image: parse(imageSchema, candidate.image),
            qualityScore: candidate.qualityScore,
          }))
        : null;
    },
    async createHighlight(highlight, actorKey) {
      if (!await userMutableCollection(database, highlight.scopeKey, highlight.collectionKey)) return null;
      return transaction(
        {
          read: [
            "scopes",
            "userOrganizations",
            "scopeMembers",
            "collections",
            "collectionMembers",
            "images",
            "collectionImages",
          ],
          write: ["imageCollecitionHightlights"],
        },
        async (tx) => {
          const access = (
            (await all(
              tx,
              'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || collectionMember.role == "owner" LET selected = (FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == imageKey LIMIT 1 RETURN 1) > 0 RETURN imageKey) RETURN { selected }',
              {
                scopeKey: highlight.scopeKey,
                collectionKey: highlight.collectionKey,
                imageKeys: highlight.imageKeys,
                actorKey,
              },
            )) as Array<{ selected: string[] }>
          )[0];
          if (!access) return null;
          const current = { ...highlight, imageKeys: access.selected };
          const value = (
            await all(
              tx,
              "UPSERT { _key: @highlightKey } INSERT @highlight UPDATE {} IN imageCollecitionHightlights RETURN NEW",
              { highlightKey: highlight.key, highlight: toArangoDoc(current) },
            )
          )[0];
          return value ? parse(imageCollectionHighlightSchema, value) : null;
        },
      );
    },
    listHighlights(scopeKey, collectionKey, actorKey) {
      return highlightRows(
        'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET elevated = actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey FILTER @collectionKey == null || highlight.collectionKey == @collectionKey LET collection = DOCUMENT(collections, highlight.collectionKey) LET collectionMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == highlight.collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN member) FILTER collection != null && collection.scopeKey == @scopeKey && (elevated || collectionMember != null) LET visible = (FOR imageKey IN highlight.imageKeys LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == highlight.collectionKey && relation.imageKey == imageKey LIMIT 1 RETURN 1) > 0 RETURN image) SORT highlight.createdAt ASC, highlight._key ASC RETURN { highlight, images: visible }',
        { scopeKey, collectionKey: collectionKey ?? null, actorKey },
      );
    },
    async getHighlight(scopeKey, highlightKey, actorKey) {
      return (
        (
          await highlightRows(
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET highlight = DOCUMENT(imageCollecitionHightlights, @highlightKey) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && highlight != null && highlight.scopeKey == @scopeKey LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collection = DOCUMENT(collections, highlight.collectionKey) LET collectionMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == highlight.collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN member) FILTER collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || collectionMember != null LET visible = (FOR imageKey IN highlight.imageKeys LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == highlight.collectionKey && relation.imageKey == imageKey LIMIT 1 RETURN 1) > 0 RETURN image) RETURN { highlight, images: visible }',
            { scopeKey, highlightKey, actorKey },
          )
        )[0] ?? null
      );
    },
    async deleteHighlight(scopeKey, highlightKey, actorKey) {
      const mutable = await all(database, 'LET highlight = DOCUMENT(imageCollecitionHightlights, @highlightKey) LET collection = highlight == null ? null : DOCUMENT(collections, highlight.collectionKey) FILTER highlight != null && highlight.scopeKey == @scopeKey && collection != null && collection.mutationPolicy != "system-only" RETURN true', { scopeKey, highlightKey });
      if (!mutable.length) return null;
      const value = (await all(database, 'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET highlight = DOCUMENT(imageCollecitionHightlights, @highlightKey) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && highlight != null && highlight.scopeKey == @scopeKey LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == highlight.collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null REMOVE highlight IN imageCollecitionHightlights RETURN OLD', { scopeKey, highlightKey, actorKey }))[0];
      return value ? parse(imageCollectionHighlightSchema, value) : null;
    },
    async listMemoryCandidates(scopeKey, collectionKey, actorKey) {
      if (!await userMutableCollection(database, scopeKey, collectionKey)) return null;
      const row = (
        (await all(
          database,
          'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null LET candidates = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey FILTER LENGTH(FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey == relation.imageKey LIMIT 1 RETURN 1) == 0 LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey) LET captionText = caption != null && caption.scopeKey == @scopeKey && IS_STRING(caption.caption) ? caption.caption : image.caption LET captionScore = caption != null && caption.scopeKey == @scopeKey && IS_NUMBER(caption.score) && caption.score >= 1 && caption.score <= 100 ? caption.score : 1 LET identityNames = UNIQUE(FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.createdByKey == @actorKey FILTER IS_ARRAY(identity.embedding) && LENGTH(identity.embedding) == LENGTH(image.embedding) LET confidence = COSINE_SIMILARITY(identity.embedding, image.embedding) FILTER IS_NUMBER(confidence) && confidence >= 0.82 SORT identity.name RETURN identity.name) RETURN { image, caption: captionText, captionScore, identityNames }) RETURN candidates',
          { scopeKey, collectionKey, actorKey },
        )) as Array<
          Array<{
            image: unknown;
            caption: string;
            captionScore: number;
            identityNames: string[];
          }>
        >
      )[0];
      return row
        ? row.map((candidate) => ({
            ...candidate,
            image: parse(imageSchema, candidate.image),
          }))
        : null;
    },
    async createMemory(memory, collectionKey, actorKey) {
      if (!await userMutableCollection(database, memory.scopeKey, collectionKey)) return { status: 'forbidden' as const, collectionKeys: [] };
      return transaction(
        {
          read: [
            "scopes",
            "userOrganizations",
            "scopeMembers",
            "collections",
            "collectionMembers",
            "images",
            "collectionImages",
          ],
          write: ["imageCollectionMemories"],
        },
        async (tx) => {
          const access = await all(
            tx,
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null RETURN true',
            { scopeKey: memory.scopeKey, collectionKey, actorKey },
          );
          if (!access.length)
            return { status: "forbidden" as const, collectionKeys: [] };
          const replay = (await all(
            tx,
            "LET existing = DOCUMENT(imageCollectionMemories, @memoryKey) FILTER existing != null && existing.scopeKey == @scopeKey LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == existing.imageKey RETURN DISTINCT relation.collectionKey) RETURN collectionKeys",
            { memoryKey: memory.key, scopeKey: memory.scopeKey },
          )) as string[][];
          if (replay[0])
            return { status: "replay" as const, collectionKeys: replay[0] };
          const eligible = await all(
            tx,
            "LET image = DOCUMENT(images, @imageKey) FILTER image != null && image.scopeKey == @scopeKey FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == @imageKey LIMIT 1 RETURN 1) > 0 RETURN true",
            {
              scopeKey: memory.scopeKey,
              collectionKey,
              imageKey: memory.imageKey,
            },
          );
          if (!eligible.length)
            return { status: "exhausted" as const, collectionKeys: [] };
          const inserted = await all(
            tx,
            "UPSERT { scopeKey: @scopeKey, imageKey: @imageKey } INSERT @memory UPDATE {} IN imageCollectionMemories RETURN OLD == null",
            {
              scopeKey: memory.scopeKey,
              imageKey: memory.imageKey,
              memory: toArangoDoc(memory),
            },
          );
          const collectionKeys = (await all(
            tx,
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN DISTINCT relation.collectionKey",
            { scopeKey: memory.scopeKey, imageKey: memory.imageKey },
          )) as string[];
          return {
            status:
              inserted[0] === true
                ? ("created" as const)
                : ("exhausted" as const),
            collectionKeys,
          };
        },
      );
    },
    listMemories(scopeKey, collectionKey, actorKey) {
      return memoryRows(
        'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET collection = DOCUMENT(collections, @collectionKey) LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && collection != null && collection.scopeKey == @scopeKey FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || member != null FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey LET memory = FIRST(FOR candidate IN imageCollectionMemories FILTER candidate.scopeKey == @scopeKey && candidate.imageKey == relation.imageKey LIMIT 1 RETURN candidate) FILTER memory != null LET image = DOCUMENT(images, memory.imageKey) FILTER image != null && image.scopeKey == @scopeKey LET collectionKeys = (FOR current IN collectionImages FILTER current.scopeKey == @scopeKey && current.imageKey == image._key RETURN DISTINCT current.collectionKey) SORT memory.createdAt ASC, memory._key ASC RETURN { memory, image, collectionKeys }',
        { scopeKey, collectionKey, actorKey },
      );
    },
    async getAccessibleMemory(scopeKey, memoryKey, actorKey) {
      return (
        (
          await memoryRows(
            'LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET memory = DOCUMENT(imageCollectionMemories, @memoryKey) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && memory != null && memory.scopeKey == @scopeKey LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == memory.imageKey RETURN DISTINCT relation.collectionKey) LET memberAccess = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN collectionKeys && member.memberKey == @actorKey LIMIT 1 RETURN 1) > 0 FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || memberAccess LET image = DOCUMENT(images, memory.imageKey) FILTER image != null && image.scopeKey == @scopeKey && LENGTH(collectionKeys) > 0 RETURN { memory, image, collectionKeys }',
            { scopeKey, memoryKey, actorKey },
          )
        )[0] ?? null
      );
    },
    async deleteAccessibleMemory(scopeKey, memoryKey, collectionKey, actorKey) {
      if (!await userMutableCollection(database, scopeKey, collectionKey) || !await userMutableMemory(database, scopeKey, memoryKey)) return null;
      return ((await memoryRows('LET actor = DOCUMENT(userOrganizations, @actorKey) LET scope = DOCUMENT(scopes, @scopeKey) LET memory = DOCUMENT(imageCollectionMemories, @memoryKey) FILTER actor != null && actor.status == "active" && scope != null && actor.organizationId == scope.organizationKey && memory != null && memory.scopeKey == @scopeKey LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN member.role) LET requestedCollection = DOCUMENT(collections, @collectionKey) LET requestedRelation = FIRST(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == memory.imageKey LIMIT 1 RETURN relation) LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey && member.role == "owner" LIMIT 1 RETURN member) FILTER requestedCollection != null && requestedCollection.scopeKey == @scopeKey && requestedRelation != null FILTER actor.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || owner != null LET collectionKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == memory.imageKey RETURN DISTINCT relation.collectionKey) LET image = DOCUMENT(images, memory.imageKey) FILTER image != null && image.scopeKey == @scopeKey REMOVE memory IN imageCollectionMemories RETURN { memory: OLD, image, collectionKeys }', { scopeKey, memoryKey, collectionKey, actorKey })))[0] ?? null;
    },
  };
}

let defaultRepository: GalleryRepository | undefined;
export function getDefaultGalleryRepository() { return defaultRepository ??= createGalleryRepository(); }
