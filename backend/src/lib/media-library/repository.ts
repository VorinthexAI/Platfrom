import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { imageSchema } from '@/lib/db/images.node';
import { collectionSchema } from '@/lib/db/collections.node';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { collectionMemberSchema } from '@/lib/db/collection-members.node';
import { collectionInviteSchema, type CollectionInvite } from '@/lib/db/collection-invites.node';
import { tagSchema } from '@/lib/db/tags.node';
import { tagAssignmentSchema } from '@/lib/db/tag-assignments.node';
import { shareSchema } from '@/lib/db/shares.node';

export interface MediaLibraryDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>; }
export type MediaLibraryTransactionRunner = <T>(operation: (database: MediaLibraryDatabase) => Promise<T>) => Promise<T>;
type Image = ReturnType<typeof imageSchema.parse>;
type Collection = ReturnType<typeof collectionSchema.parse>;
type CollectionImage = ReturnType<typeof collectionImageSchema.parse>;
type CollectionMember = ReturnType<typeof collectionMemberSchema.parse>;
type Tag = ReturnType<typeof tagSchema.parse>;
type TagAssignment = ReturnType<typeof tagAssignmentSchema.parse>;
type GlobalShare = ReturnType<typeof shareSchema.parse>;
const transactionCollections = ['images', 'collections', 'collectionImages', 'collectionMembers', 'collectionInvites', 'tags', 'tagAssignments', 'shares', 'documents', 'places', 'scopes', 'scopeMembers', 'userOrganizations', 'users'] as const;
const defaultTransactionRunner: MediaLibraryTransactionRunner = (operation) => withTransaction([...transactionCollections], (transaction) => operation(transaction));

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T { return schema.parse(withArangoKey(value as Record<string, unknown>)); }
async function one(database: MediaLibraryDatabase, query: string, bindVars: Record<string, unknown>): Promise<unknown | null> { return (await (await database.query(query, bindVars)).all())[0] ?? null; }
const activeActor = `LET actorMembership = DOCUMENT(userOrganizations, @actorKey) LET actorScope = DOCUMENT(scopes, @scopeKey) FILTER actorMembership != null && actorMembership.status == "active" FILTER actorScope != null && actorMembership.organizationId == actorScope.organizationKey LET elevated = actorMembership.orgRole IN ["owner", "admin"] LET scopedRole = FIRST(FOR scopeMember IN scopeMembers FILTER scopeMember.scopeKey == @scopeKey && scopeMember.userOrganizationKey == @actorKey && scopeMember.status == "active" LIMIT 1 RETURN scopeMember.role) LET scoped = scopedRole != null LET writable = scopedRole IN ["owner", "admin", "moderator"]`;

export interface MediaLibraryRepository {
  getImage(scopeKey: string, imageKey: string): Promise<Image | null>;
  getCollection(scopeKey: string, collectionKey: string): Promise<Collection | null>;
  ownsImage(scopeKey: string, imageKey: string, ownerKey: string): Promise<boolean>;
  canAccessImage(scopeKey: string, imageKey: string, actorKey: string): Promise<boolean>;
  canAccessCollection(scopeKey: string, collectionKey: string, actorKey: string): Promise<boolean>;
  canManageScope(scopeKey: string, actorKey: string): Promise<boolean>;
  ownsCollection(scopeKey: string, collectionKey: string, ownerKey: string): Promise<boolean>;
  addImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  copyImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  moveImageBetweenCollections(sourceCollectionKey: string, relation: CollectionImage): Promise<CollectionImage>;
  leaveCollection(scopeKey: string, collectionKey: string, actorKey: string): Promise<boolean>;
  createCollectionInvite(invite: CollectionInvite, replay: { requestHash: string; responseCiphertext: string }): Promise<{ invite: CollectionInvite; requestHash: string; responseCiphertext: string }>;
  getAcceptedCollectionInviteMembership(tokenHash: string, recipientKey: string): Promise<CollectionMember | null>;
  acceptCollectionInvite(input: { tokenHash: string; recipientKey: string; now: string; memberKey: string }): Promise<CollectionMember | null>;
  acceptCollectionInviteAtomic(input: { tokenHash: string; recipientKey: string; now: string; memberKey: string }): Promise<CollectionMember | null>;
  updateAcceptedCollectionInviteRole(tokenHash: string, recipientKey: string): Promise<CollectionMember | null>;
  createTagAssignment(assignment: TagAssignment, actorKey: string): Promise<TagAssignment | null>;
  setCollectionCoverImage(scopeKey: string, collectionKey: string, imageKey: string, ownerKey: string, now: string): Promise<Collection | null>;
  createGlobalShare(share: GlobalShare, ownerKey: string, replay: { requestHash: string; responseCiphertext: string }): Promise<{ share: GlobalShare; requestHash: string; responseCiphertext: string } | null>;
  getActiveGlobalShareByTokenHash(tokenHash: string, at: string): Promise<GlobalShare | null>;
  getTag(scopeKey: string, tagKey: string): Promise<Tag | null>;
}

export interface AccessibleImageSearchInput {
  organizationKey: string;
  scopeKey: string;
  actorKey: string;
  collectionKey?: string;
  embedding: number[];
  threshold?: number;
  limit: number;
}

export interface AccessibleImageSearchResult {
  image: Image;
  score: number;
}

export async function searchAccessibleImages(
  input: AccessibleImageSearchInput,
  database: MediaLibraryDatabase = db,
): Promise<AccessibleImageSearchResult[]> {
  const cursor = await database.query(`
    LET actorMembership = DOCUMENT(userOrganizations, @actorKey)
    LET actorScope = DOCUMENT(scopes, @scopeKey)
    FILTER actorMembership != null
    FILTER actorMembership.status == "active"
    FILTER actorMembership.organizationId == @organizationKey
    FILTER actorScope != null
    FILTER actorScope.organizationKey == @organizationKey
    LET elevated = actorMembership.orgRole IN ["owner", "admin"]
    LET scoped = LENGTH(
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey
        FILTER scopeMember.userOrganizationKey == @actorKey
        FILTER scopeMember.status == "active"
        LIMIT 1
        RETURN 1
    ) > 0
    LET scopeRole = FIRST(
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey && scopeMember.userOrganizationKey == @actorKey && scopeMember.status == "active"
        LIMIT 1
        RETURN scopeMember.role
    )
    LET privileged = elevated || scopeRole IN ["owner", "admin"]
    FOR image IN images
      FILTER image.scopeKey == @scopeKey
      FILTER @collectionKey == null || LENGTH(
        FOR collectionImage IN collectionImages
          FILTER collectionImage.scopeKey == @scopeKey
          FILTER collectionImage.collectionKey == @collectionKey
          FILTER collectionImage.imageKey == image._key
          LIMIT 1
          RETURN 1
      ) > 0
      LET collectionAccess = LENGTH(
        FOR relation IN collectionImages
          FILTER relation.scopeKey == @scopeKey
          FILTER relation.imageKey == image._key
          LET collection = DOCUMENT(collections, relation.collectionKey)
          FILTER collection != null
          FILTER collection.scopeKey == @scopeKey
          FOR member IN collectionMembers
            FILTER member.scopeKey == @scopeKey
            FILTER member.collectionKey == relation.collectionKey
            FILTER member.memberKey == @actorKey
            LIMIT 1
            RETURN 1
      ) > 0
      LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key RETURN 1)
      FILTER privileged || (image.createdByKey == @actorKey && relationCount == 0) || collectionAccess
      FILTER IS_ARRAY(image.embedding)
      FILTER LENGTH(image.embedding) == @dimensions
      FILTER LENGTH(image.embedding[* FILTER !IS_NUMBER(CURRENT)]) == 0
      LET score = COSINE_SIMILARITY(image.embedding, @embedding)
      FILTER IS_NUMBER(score)
      FILTER @threshold == null || score >= @threshold
      SORT score DESC, image._key ASC
      LIMIT @limit
      RETURN { image, score }
  `, {
    organizationKey: input.organizationKey,
    scopeKey: input.scopeKey,
    actorKey: input.actorKey,
    collectionKey: input.collectionKey ?? null,
    embedding: input.embedding,
    dimensions: input.embedding.length,
    threshold: input.threshold ?? null,
    limit: input.limit,
  });
  return (await cursor.all()).map((value) => {
    const row = value as { image?: unknown; score?: unknown };
    if (typeof row.score !== 'number' || !Number.isFinite(row.score)) throw new Error('Image similarity query returned an invalid score.');
    return { image: parse(imageSchema, row.image), score: row.score };
  });
}

export function createMediaLibraryRepository(database: MediaLibraryDatabase = db, runTransaction: MediaLibraryTransactionRunner = defaultTransactionRunner): MediaLibraryRepository {
  const add = async (relation: CollectionImage) => {
    const valid = collectionImageSchema.parse(relation);
    const value = await one(database, `LET image = DOCUMENT(images, @imageKey) LET collection = DOCUMENT(collections, @collectionKey) ${activeActor} LET actor = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @addedByKey LIMIT 1 RETURN member) LET sourceAccess = scoped || elevated || LENGTH(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.imageKey == @imageKey LET sourceCollection = DOCUMENT(collections, link.collectionKey) FILTER sourceCollection != null FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == link.collectionKey && member.memberKey == @addedByKey LIMIT 1 RETURN 1) > 0 FILTER image != null && collection != null FILTER image.scopeKey == @scopeKey && collection.scopeKey == @scopeKey && actor != null && sourceAccess UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages RETURN NEW`, { scopeKey: valid.scopeKey, collectionKey: valid.collectionKey, imageKey: valid.imageKey, addedByKey: valid.addedByKey, actorKey: valid.addedByKey, relation: toArangoDoc(valid) });
    if (!value) throw new MediaLibraryReferenceError('Source image access, destination membership, and live same-scope resources are required');
    return parse(collectionImageSchema, value);
  };
  const owns = async (kind: 'image' | 'collection', scopeKey: string, resourceKey: string, ownerKey: string) => Boolean(await one(database, kind === 'collection'
    ? `LET target = DOCUMENT(collections, @resourceKey) ${activeActor} FILTER target != null && target.scopeKey == @scopeKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @resourceKey && member.memberKey == @ownerKey && member.role == "owner" LIMIT 1 RETURN true`
    : `LET target = DOCUMENT(images, @resourceKey) ${activeActor} FILTER target != null && target.scopeKey == @scopeKey FILTER writable || elevated || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @resourceKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @ownerKey && member.role == "owner" LIMIT 1 RETURN 1) > 0 RETURN true`, { scopeKey, resourceKey, ownerKey, actorKey: ownerKey }));
  return {
    async getImage(scopeKey, imageKey) { const value = await one(database, 'FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN image', { scopeKey, imageKey }); return value ? parse(imageSchema, value) : null; },
    async getCollection(scopeKey, collectionKey) { const value = await one(database, 'FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey LIMIT 1 RETURN collection', { scopeKey, collectionKey }); return value ? parse(collectionSchema, value) : null; },
    ownsImage: (scopeKey, imageKey, ownerKey) => owns('image', scopeKey, imageKey, ownerKey),
    canAccessImage: async (scopeKey, imageKey, actorKey) => Boolean(await one(database, `LET image = DOCUMENT(images, @imageKey) ${activeActor} LET privileged = elevated || scopedRole IN ["owner", "admin"] FILTER image != null && image.scopeKey == @scopeKey LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN 1) FILTER privileged || (image.createdByKey == @actorKey && relationCount == 0) || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN 1) > 0 RETURN true`, { scopeKey, imageKey, actorKey })),
    canAccessCollection: async (scopeKey, collectionKey, actorKey) => Boolean(await one(database, `LET collection = DOCUMENT(collections, @collectionKey) ${activeActor} LET privileged = elevated || scopedRole IN ["owner", "admin"] FILTER collection != null && collection.scopeKey == @scopeKey FILTER privileged || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN 1) > 0 RETURN true`, { scopeKey, collectionKey, actorKey })),
    canManageScope: async (scopeKey, actorKey) => Boolean(await one(database, `${activeActor} FILTER writable || elevated RETURN true`, { scopeKey, actorKey })),
    ownsCollection: (scopeKey, collectionKey, ownerKey) => owns('collection', scopeKey, collectionKey, ownerKey),
    addImageToCollection: add, copyImageToCollection: add,
    moveImageBetweenCollections(sourceCollectionKey, relation) { return runTransaction(async (transaction) => { const bound = createMediaLibraryRepository(transaction, runTransaction); const source = await one(transaction, `${activeActor} LET image = DOCUMENT(images, @imageKey) LET current = FIRST(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.collectionKey == @sourceCollectionKey && link.imageKey == @imageKey LIMIT 1 RETURN link) LET sourceMember = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @sourceCollectionKey && member.memberKey == @actorKey LIMIT 1 RETURN member) FILTER image != null && current != null && (scoped || elevated || sourceMember != null) RETURN current`, { scopeKey: relation.scopeKey, sourceCollectionKey, imageKey: relation.imageKey, actorKey: relation.addedByKey }); if (!source) throw new MediaLibraryReferenceError('Source collection does not contain an accessible image'); const destination = await bound.addImageToCollection(relation); if (sourceCollectionKey !== relation.collectionKey) { await transaction.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @sourceCollectionKey && relation.imageKey == @imageKey REMOVE relation IN collectionImages', { scopeKey: relation.scopeKey, sourceCollectionKey, imageKey: relation.imageKey }); await transaction.query('FOR collection IN collections FILTER collection._key == @sourceCollectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey == @imageKey UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false }', { scopeKey: relation.scopeKey, sourceCollectionKey, imageKey: relation.imageKey, now: relation.createdAt }); } return destination; }); },
    leaveCollection(scopeKey, collectionKey, actorKey) { return runTransaction(async (transaction) => Boolean(await one(transaction, `${activeActor} LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) LET otherOwners = member == null ? 0 : LENGTH(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @collectionKey && candidate.role == "owner" && candidate.memberKey != @actorKey LIMIT 1 RETURN 1) FILTER member != null && (member.role != "owner" || otherOwners > 0) REMOVE member IN collectionMembers RETURN true`, { scopeKey, collectionKey, actorKey }))); },
    createCollectionInvite(invite, replay) { return runTransaction(async (transaction) => { const valid = collectionInviteSchema.parse(invite); const value = await one(transaction, `LET collection = DOCUMENT(collections, @collectionKey) ${activeActor} LET owner = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @invitedByKey && member.role == "owner" LIMIT 1 RETURN member) FILTER collection != null && collection.scopeKey == @scopeKey && owner != null UPSERT { _key: @inviteKey } INSERT MERGE(@invite, @replay) UPDATE {} IN collectionInvites RETURN NEW`, { scopeKey: valid.scopeKey, collectionKey: valid.collectionKey, invitedByKey: valid.invitedByKey, actorKey: valid.invitedByKey, inviteKey: valid.key, invite: toArangoDoc(valid), replay }); if (!value) throw new MediaLibraryReferenceError('Collection ownership required'); const raw = withArangoKey(value as Record<string, unknown>) as Record<string, unknown>; return { invite: collectionInviteSchema.parse(raw), requestHash: String(raw.requestHash), responseCiphertext: String(raw.responseCiphertext) }; }); },
    async getAcceptedCollectionInviteMembership(tokenHash, recipientKey) { const value = await one(database, 'LET recipientMembership = DOCUMENT(userOrganizations, @recipientKey) LET recipient = recipientMembership == null ? null : DOCUMENT(users, recipientMembership.userId) FOR invite IN collectionInvites FILTER invite.tokenHash == @tokenHash && invite.acceptedAt != null && invite.revokedAt == null FILTER invite.inviteeKey == @recipientKey || (invite.email != null && recipient != null && invite.email == LOWER(recipient.email)) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == invite.scopeKey && candidate.collectionKey == invite.collectionKey && candidate.memberKey == @recipientKey LIMIT 1 RETURN candidate) FILTER member != null LIMIT 1 RETURN member', { tokenHash, recipientKey }); return value ? parse(collectionMemberSchema, value) : null; },
    acceptCollectionInvite({ tokenHash, recipientKey, now, memberKey }) { return runTransaction(async (transaction) => { const inviteValue = await one(transaction, 'LET recipientMembership = DOCUMENT(userOrganizations, @recipientKey) LET recipient = recipientMembership == null ? null : DOCUMENT(users, recipientMembership.userId) FOR invite IN collectionInvites FILTER invite.tokenHash == @tokenHash FILTER invite.inviteeKey == @recipientKey || (invite.email != null && recipient != null && invite.email == LOWER(recipient.email)) FILTER invite.acceptedAt == null && invite.revokedAt == null && (invite.expiresAt == null || invite.expiresAt > @now) LET collection = DOCUMENT(collections, invite.collectionKey) LET scope = DOCUMENT(scopes, invite.scopeKey) LET inviter = FIRST(FOR owner IN collectionMembers FILTER owner.scopeKey == invite.scopeKey && owner.collectionKey == invite.collectionKey && owner.memberKey == invite.invitedByKey && owner.role == "owner" LIMIT 1 RETURN owner) FILTER collection != null && collection.scopeKey == invite.scopeKey && inviter != null FILTER recipientMembership != null && recipientMembership.status == "active" && scope != null && recipientMembership.organizationId == scope.organizationKey LIMIT 1 RETURN invite', { tokenHash, recipientKey, now }); if (!inviteValue) return null; const invite = parse(collectionInviteSchema, inviteValue); const member = collectionMemberSchema.parse({ key: memberKey, scopeKey: invite.scopeKey, collectionKey: invite.collectionKey, memberKey: recipientKey, createdAt: now }); const saved = await one(transaction, 'UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @memberKey } INSERT @member UPDATE {} IN collectionMembers RETURN NEW', { scopeKey: member.scopeKey, collectionKey: member.collectionKey, memberKey: member.memberKey, member: toArangoDoc(member) }); await transaction.query('UPDATE @inviteKey WITH { acceptedAt: @now, updatedAt: @now } IN collectionInvites', { inviteKey: invite.key, now }); return parse(collectionMemberSchema, saved); }); },
    async updateAcceptedCollectionInviteRole(tokenHash, recipientKey) { const value = await one(database, 'LET invite = FIRST(FOR item IN collectionInvites FILTER item.tokenHash == @tokenHash && item.acceptedAt != null && item.revokedAt == null FILTER item.inviteeKey == @recipientKey || item.email == LOWER(DOCUMENT(users, DOCUMENT(userOrganizations, @recipientKey).userId).email) LIMIT 1 RETURN item) FILTER invite != null FOR member IN collectionMembers FILTER member.scopeKey == invite.scopeKey && member.collectionKey == invite.collectionKey && member.memberKey == @recipientKey UPDATE member WITH { role: invite.role == "viewer" ? "viewer" : "collaborator" } IN collectionMembers RETURN NEW', { tokenHash, recipientKey }); return value ? parse(collectionMemberSchema, value) : null; },
    acceptCollectionInviteAtomic({ tokenHash, recipientKey, now, memberKey }) { return runTransaction(async (transaction) => {
      const inviteValue = await one(transaction, 'LET recipientMembership = DOCUMENT(userOrganizations, @recipientKey) LET recipient = recipientMembership == null ? null : DOCUMENT(users, recipientMembership.userId) FOR invite IN collectionInvites FILTER invite.tokenHash == @tokenHash && invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null && (invite.expiresAt == null || invite.expiresAt > @now) FILTER invite.inviteeKey == @recipientKey || (invite.email != null && recipient != null && invite.email == LOWER(recipient.email)) LET scope = DOCUMENT(scopes, invite.scopeKey) LET collection = DOCUMENT(collections, invite.collectionKey) LET inviter = FIRST(FOR owner IN collectionMembers FILTER owner.scopeKey == invite.scopeKey && owner.collectionKey == invite.collectionKey && owner.memberKey == invite.invitedByKey && owner.role == "owner" LIMIT 1 RETURN owner) FILTER recipientMembership != null && recipientMembership.status == "active" && scope != null && recipientMembership.organizationId == scope.organizationKey && collection != null && collection.scopeKey == invite.scopeKey && inviter != null LIMIT 1 RETURN invite', { tokenHash, recipientKey, now });
      if (!inviteValue) return null;
      const invite = parse(collectionInviteSchema, inviteValue);
      const requestedRole = invite.role === 'viewer' ? 'viewer' : 'collaborator';
      const saved = await one(transaction, 'UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @recipientKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @recipientKey, role: @requestedRole, createdAt: @now } UPDATE { role: OLD.role == "owner" || OLD.role == "collaborator" ? OLD.role : @requestedRole } IN collectionMembers RETURN NEW', { scopeKey: invite.scopeKey, collectionKey: invite.collectionKey, recipientKey, memberKey, requestedRole, now });
      if (!saved) return null;
      const finalized = await one(transaction, 'FOR invite IN collectionInvites FILTER invite._key == @inviteKey && invite.acceptedAt == null && invite.rejectedAt == null && invite.revokedAt == null UPDATE invite WITH { acceptedAt: @now, updatedAt: @now } IN collectionInvites RETURN true', { inviteKey: invite.key, now });
      if (!finalized) throw new MediaLibraryReferenceError('Invite acceptance could not be finalized');
      return parse(collectionMemberSchema, saved);
    }); },
    async createTagAssignment(assignment, actorKey) { const valid = tagAssignmentSchema.parse(assignment); const targetCollection = valid.sourceType === 'document' ? 'documents' : valid.sourceType === 'image' ? 'images' : valid.sourceType === 'collection' ? 'collections' : 'places'; const value = await one(database, `LET tag = DOCUMENT(tags, @tagKey) LET target = DOCUMENT(${targetCollection}, @sourceKey) LET scope = DOCUMENT(scopes, @scopeKey) LET membership = DOCUMENT(userOrganizations, @actorKey) LET active = scope != null && membership != null && membership.status == "active" && membership.organizationId == scope.organizationKey LET elevated = active && membership.orgRole IN ["owner", "admin"] LET scoped = LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @actorKey && member.status == "active" LIMIT 1 RETURN 1) > 0 LET mediaLibrary = @sourceType == "collection" ? LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @sourceKey && member.memberKey == @actorKey LIMIT 1 RETURN 1) > 0 : @sourceType == "image" ? LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @sourceKey FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @actorKey LIMIT 1 RETURN 1) > 0 : false FILTER tag != null && tag.scopeKey == @scopeKey && target != null && target.scopeKey == @scopeKey FILTER active && (mediaLibrary || scoped || elevated) UPSERT { scopeKey: @scopeKey, tagKey: @tagKey, sourceType: @sourceType, sourceKey: @sourceKey } INSERT @assignment UPDATE { source: @source } IN tagAssignments RETURN NEW`, { scopeKey: valid.scopeKey, tagKey: valid.tagKey, sourceType: valid.sourceType, sourceKey: valid.sourceKey, source: valid.source, actorKey, assignment: toArangoDoc(valid) }); return value ? parse(tagAssignmentSchema, value) : null; },
    async setCollectionCoverImage(scopeKey, collectionKey, imageKey, ownerKey, now) { const value = await one(database, `LET image = DOCUMENT(images, @imageKey) ${activeActor} LET relation = FIRST(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.collectionKey == @collectionKey && link.imageKey == @imageKey LIMIT 1 RETURN link) FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @collectionKey && member.memberKey == @ownerKey && member.role == "owner" FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey FILTER image != null && image.scopeKey == @scopeKey && relation != null LIMIT 1 UPDATE collection WITH { coverImageKey: @imageKey, updatedAt: @now } IN collections RETURN NEW`, { scopeKey, collectionKey, imageKey, ownerKey, actorKey: ownerKey, now }); return value ? parse(collectionSchema, value) : null; },
    async createGlobalShare(share, ownerKey, replay) { const valid = shareSchema.parse(share); if (valid.sourceType === 'document') return null; const targetCollection = valid.sourceType === 'image' ? 'images' : valid.sourceType === 'collection' ? 'collections' : 'places'; const value = await one(database, `LET target = DOCUMENT(${targetCollection}, @sourceKey) ${activeActor} LET owned = @sourceType == "collection" ? LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == @sourceKey && member.memberKey == @ownerKey && member.role == "owner" LIMIT 1 RETURN 1) > 0 : @sourceType == "image" ? writable || elevated || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @sourceKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == relation.collectionKey && member.memberKey == @ownerKey && member.role == "owner" LIMIT 1 RETURN 1) > 0 : writable || elevated FILTER target != null && target.scopeKey == @scopeKey && owned UPSERT { _key: @shareKey } INSERT MERGE(@share, @replay) UPDATE {} IN shares RETURN NEW`, { scopeKey: valid.scopeKey, sourceType: valid.sourceType, sourceKey: valid.sourceKey, ownerKey, actorKey: ownerKey, shareKey: valid.key, share: toArangoDoc(valid), replay }); if (!value) return null; const raw = withArangoKey(value as Record<string, unknown>) as Record<string, unknown>; return { share: shareSchema.parse(raw), requestHash: String(raw.requestHash), responseCiphertext: String(raw.responseCiphertext) }; },
    async getActiveGlobalShareByTokenHash(tokenHash, at) { const value = await one(database, 'FOR share IN shares FILTER share.sourceType IN ["image", "collection", "place"] && share.tokenHash == @tokenHash FILTER share.revokedAt == null && (share.expiresAt == null || share.expiresAt > @at) LET scope = DOCUMENT(scopes, share.scopeKey) LET source = share.sourceType == "image" ? DOCUMENT(images, share.sourceKey) : share.sourceType == "collection" ? DOCUMENT(collections, share.sourceKey) : DOCUMENT(places, share.sourceKey) FILTER scope != null && source != null && source.scopeKey == share.scopeKey LIMIT 1 RETURN share', { tokenHash, at }); return value ? parse(shareSchema, value) : null; },
    async getTag(scopeKey, tagKey) { const value = await one(database, 'FOR tag IN tags FILTER tag._key == @tagKey && tag.scopeKey == @scopeKey LIMIT 1 RETURN tag', { scopeKey, tagKey }); return value ? parse(tagSchema, value) : null; },
  };
}

export class MediaLibraryReferenceError extends Error { constructor(message: string) { super(message); this.name = 'MediaLibraryReferenceError'; } }
let defaultRepository: MediaLibraryRepository | undefined;
export function getDefaultMediaLibraryRepository(): MediaLibraryRepository { return defaultRepository ??= createMediaLibraryRepository(); }
