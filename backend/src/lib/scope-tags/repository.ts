import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { tagSchema, type Tag } from '@/lib/db/tags.node';
import { sourceTypeSchema, tagAssignmentSchema, type TagAssignment } from '@/lib/db/tag-assignments.node';

export type ScopeTagOwner = { organizationKey: string; scopeKey: string; userKey: string; membershipKey: string };
export type ScopeTagTarget = { type: TagAssignment['sourceType']; key: string };
export type ScopeTagListQuery = { target?: ScopeTagTarget; cursor?: { normalizedName: string; key: string }; limit: number };
export type ScopeTagAssignmentChange = { tagKey: string; target: ScopeTagTarget; assigned: boolean };
export type ScopeTagMatch = 'any' | 'all';
export type ScopeTagProjection = Pick<Tag, 'key' | 'name'>;
export type RankedScopeTagTarget = { key: string; score: number };
export type RankedScopeTag = Tag & { score: number };
export type ScopeTagAssignmentProjection = { key: string; tag: ScopeTagProjection; target: ScopeTagTarget & { label: string } };
export type ScopeTagAssignmentQuery = { tagKeys?: string[]; tagMatch: ScopeTagMatch; targetTypes?: TagAssignment['sourceType'][]; limit?: number };
export type ScopeTagTargetAssignmentState = { target: ScopeTagTarget; tagKeys: string[] };

export const SCOPE_TAG_TARGETS = {
  folder: 'folders', document: 'documents', 'image-collection': 'collections', image: 'images',
  'image-highlight': 'imageCollecitionHightlights', 'image-memory': 'imageCollectionMemories',
  place: 'places', trip: 'trips', 'email-inbox': 'emailInboxes', 'email-tone': 'emailTones',
  'email-thread': 'emailThreads', 'email-message': 'emailMessages', 'email-draft': 'emailDrafts', book: 'books',
} as const satisfies Record<TagAssignment['sourceType'], string>;

export const SCOPE_TAG_TARGET_ADAPTERS = {
  folder: { collection: 'folders', label: 'name' }, document: { collection: 'documents', label: 'name' },
  'image-collection': { collection: 'collections', label: 'name' }, image: { collection: 'images', label: 'caption or filename' },
  'image-highlight': { collection: 'imageCollecitionHightlights', label: 'collection name' }, 'image-memory': { collection: 'imageCollectionMemories', label: 'memory text or image caption' },
  place: { collection: 'places', label: 'name' }, trip: { collection: 'trips', label: 'name' },
  'email-inbox': { collection: 'emailInboxes', label: 'name or email' }, 'email-tone': { collection: 'emailTones', label: 'name' },
  'email-thread': { collection: 'emailThreads', label: 'subject' }, 'email-message': { collection: 'emailMessages', label: 'subject' },
  'email-draft': { collection: 'emailDrafts', label: 'subject or draft kind' }, book: { collection: 'books', label: 'title' },
} as const satisfies Record<TagAssignment['sourceType'], { collection: string; label: string }>;

const SCOPE_TAG_TARGET_LABEL_EXPRESSIONS = {
  folder: 'target.name', document: 'target.name', 'image-collection': 'target.name',
  image: '(LENGTH(TRIM(target.caption || "")) > 0 ? target.caption : target.filename)',
  'image-highlight': 'directCollection.name',
  'image-memory': '(LENGTH(TRIM(target.text || "")) > 0 ? target.text : (LENGTH(TRIM(image.caption || "")) > 0 ? image.caption : image.filename))',
  place: 'target.name', trip: 'target.name',
  'email-inbox': '(LENGTH(TRIM(target.name || "")) > 0 ? target.name : target.email)',
  'email-tone': 'target.name', 'email-thread': 'target.subject', 'email-message': 'target.subject',
  'email-draft': '(LENGTH(TRIM(target.subject || "")) > 0 ? target.subject : "Reply draft")', book: 'target.title',
} as const satisfies Record<TagAssignment['sourceType'], string>;

const fixedTargetExpression = Object.entries(SCOPE_TAG_TARGET_ADAPTERS).map(([type, adapter], index) => `${index ? ':' : ''} assignment.sourceType == "${type}" ? DOCUMENT(${adapter.collection}, assignment.sourceKey)`).join(' ') + ' : null';
const fixedTargetLabelExpression = Object.entries(SCOPE_TAG_TARGET_LABEL_EXPRESSIONS).map(([type, expression], index) => `${index ? ':' : ''} assignment.sourceType == "${type}" ? ${expression}`).join(' ') + ' : null';

type Cursor = { next(): Promise<unknown>; all(): Promise<unknown[]> };
export interface ScopeTagDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor>; }
export type ScopeTagTransactionRunner = <T>(operation: (database: ScopeTagDatabase) => Promise<T>) => Promise<T>;

const transactionCollections = {
  read: ['scopes', 'userOrganizations', 'scopeMembers', 'folders', 'documents', 'collections', 'collectionMembers', 'collectionImages', 'images', 'imageCollecitionHightlights', 'imageCollectionMemories', 'places', 'trips', 'emailInboxes', 'emailTones', 'emailThreads', 'emailMessages', 'emailDrafts', 'books'],
  write: ['tags', 'tagAssignments'],
};
const defaultTransaction: ScopeTagTransactionRunner = (operation) => withTransaction(transactionCollections, (transaction) => operation(transaction as unknown as ScopeTagDatabase));
const parseTag = (value: unknown) => tagSchema.parse(withArangoKey(value as Record<string, unknown>));
const parseAssignment = (value: unknown) => tagAssignmentSchema.parse(withArangoKey(value as Record<string, unknown>));

const targetAccessPreludeQuery = `
  LET membership = DOCUMENT(userOrganizations, @membershipKey)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role)
  LET active = membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey
  LET scoped = scopeRole IN ["owner", "admin", "moderator", "viewer"]
  LET elevated = membership != null && membership.orgRole IN ["owner", "admin"]
`;

// Every target branch names a fixed collection. No caller-controlled collection name reaches AQL.
const targetAccessRulesQuery = `
  LET target = @sourceType == "folder" ? DOCUMENT(folders, @sourceKey)
    : @sourceType == "document" ? DOCUMENT(documents, @sourceKey)
    : @sourceType == "image-collection" ? DOCUMENT(collections, @sourceKey)
    : @sourceType == "image" ? DOCUMENT(images, @sourceKey)
    : @sourceType == "image-highlight" ? DOCUMENT(imageCollecitionHightlights, @sourceKey)
    : @sourceType == "image-memory" ? DOCUMENT(imageCollectionMemories, @sourceKey)
    : @sourceType == "place" ? DOCUMENT(places, @sourceKey)
    : @sourceType == "trip" ? DOCUMENT(trips, @sourceKey)
    : @sourceType == "email-inbox" ? DOCUMENT(emailInboxes, @sourceKey)
    : @sourceType == "email-tone" ? DOCUMENT(emailTones, @sourceKey)
    : @sourceType == "email-thread" ? DOCUMENT(emailThreads, @sourceKey)
    : @sourceType == "email-message" ? DOCUMENT(emailMessages, @sourceKey)
    : @sourceType == "email-draft" ? DOCUMENT(emailDrafts, @sourceKey)
    : @sourceType == "book" ? DOCUMENT(books, @sourceKey) : null
  LET collectionKey = @sourceType == "image-collection" ? @sourceKey : @sourceType == "image-highlight" && target != null ? target.collectionKey : null
  LET directCollection = collectionKey == null ? null : DOCUMENT(collections, collectionKey)
  LET collectionMember = directCollection == null ? null : FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collectionKey && member.memberKey == @membershipKey LIMIT 1 RETURN member)
  LET managedCollection = directCollection != null && directCollection.mutationPolicy == "system-only" && directCollection.purpose IN ["email-media", "generated-media", "place-media"]
  LET imageKey = @sourceType == "image" ? @sourceKey : @sourceType == "image-memory" && target != null ? target.imageKey : null
  LET imageRelations = imageKey == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey RETURN relation.collectionKey)
  LET imageMemberAccess = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN imageRelations && member.memberKey == @membershipKey LIMIT 1 RETURN 1) > 0
  LET managedImageAccess = LENGTH(FOR relatedCollectionKey IN imageRelations LET collection = DOCUMENT(collections, relatedCollectionKey) FILTER collection != null && collection.mutationPolicy == "system-only" && collection.purpose IN ["email-media", "generated-media", "place-media"] LIMIT 1 RETURN 1) > 0
  LET privateTarget = @sourceType IN ["place", "trip"]
  LET collectionTarget = @sourceType IN ["image-collection", "image-highlight"]
  LET imageTarget = @sourceType IN ["image", "image-memory"]
  LET readable = active && target != null && target.scopeKey == @scopeKey && (privateTarget ? target.userKey == @userKey && (scoped || elevated) : collectionTarget ? elevated || collectionMember != null || (managedCollection && scoped) : imageTarget ? elevated || imageMemberAccess || (managedImageAccess && scoped) || (@sourceType == "image" && target.createdByKey == @membershipKey && LENGTH(imageRelations) == 0) : scoped || elevated)
`;
const targetAccessQuery = targetAccessPreludeQuery + targetAccessRulesQuery;
const batchTargetAccessRulesQuery = targetAccessRulesQuery.replaceAll('@sourceType', 'requestedTarget.type').replaceAll('@sourceKey', 'requestedTarget.key');

const assignmentProjectionQuery = `
  LET membership = DOCUMENT(userOrganizations, @membershipKey)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role)
  LET active = membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey
  LET scoped = scopeRole IN ["owner", "admin", "moderator", "viewer"]
  LET elevated = membership != null && membership.orgRole IN ["owner", "admin"]
  FILTER active && (scoped || elevated)
  FOR assignment IN tagAssignments
    FILTER assignment.scopeKey == @scopeKey
    FILTER @assignmentKey == null || assignment._key == @assignmentKey
    FILTER @targetTypes == null || assignment.sourceType IN @targetTypes
    LET tag = DOCUMENT(tags, assignment.tagKey)
    FILTER tag != null && tag.scopeKey == @scopeKey && tag.userKey == @userKey
    FILTER @tagKeys == null || assignment.tagKey IN @tagKeys
    LET matchedTags = @tagKeys == null ? 0 : LENGTH(FOR candidate IN tagAssignments FILTER candidate.scopeKey == @scopeKey && candidate.sourceType == assignment.sourceType && candidate.sourceKey == assignment.sourceKey && candidate.tagKey IN @tagKeys RETURN DISTINCT candidate.tagKey)
    FILTER @tagKeys == null || @tagMatch == "any" || matchedTags == LENGTH(@tagKeys)
    LET target = ${fixedTargetExpression}
    LET collectionKey = assignment.sourceType == "image-collection" ? assignment.sourceKey : assignment.sourceType == "image-highlight" && target != null ? target.collectionKey : null
    LET directCollection = collectionKey == null ? null : DOCUMENT(collections, collectionKey)
    LET collectionMember = directCollection == null ? null : FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collectionKey && member.memberKey == @membershipKey LIMIT 1 RETURN member)
    LET managedCollection = directCollection != null && directCollection.mutationPolicy == "system-only" && directCollection.purpose IN ["email-media", "generated-media", "place-media"]
    LET imageKey = assignment.sourceType == "image" ? assignment.sourceKey : assignment.sourceType == "image-memory" && target != null ? target.imageKey : null
    LET image = imageKey == null ? null : DOCUMENT(images, imageKey)
    LET imageRelations = imageKey == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey RETURN relation.collectionKey)
    LET imageMemberAccess = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN imageRelations && member.memberKey == @membershipKey LIMIT 1 RETURN 1) > 0
    LET managedImageAccess = LENGTH(FOR relatedCollectionKey IN imageRelations LET collection = DOCUMENT(collections, relatedCollectionKey) FILTER collection != null && collection.mutationPolicy == "system-only" && collection.purpose IN ["email-media", "generated-media", "place-media"] LIMIT 1 RETURN 1) > 0
    LET privateTarget = assignment.sourceType IN ["place", "trip"]
    LET collectionTarget = assignment.sourceType IN ["image-collection", "image-highlight"]
    LET imageTarget = assignment.sourceType IN ["image", "image-memory"]
    LET readable = target != null && target.scopeKey == @scopeKey && (privateTarget ? target.userKey == @userKey : collectionTarget ? elevated || collectionMember != null || (managedCollection && scoped) : imageTarget ? elevated || imageMemberAccess || (managedImageAccess && scoped) || (assignment.sourceType == "image" && target.createdByKey == @membershipKey && LENGTH(imageRelations) == 0) : scoped || elevated)
    FILTER readable
    LET label = ${fixedTargetLabelExpression}
    FILTER IS_STRING(label) && LENGTH(TRIM(label)) > 0
    SORT assignment.sourceType ASC, LOWER(label) ASC, tag.normalizedName ASC, assignment._key ASC
`;

const assignmentProjectionSchema = z.object({ key: z.string().cuid(), tag: z.object({ key: z.string().cuid(), name: z.string().min(1) }).strict(), target: z.object({ type: sourceTypeSchema, key: z.string().cuid(), label: z.string().min(1) }).strict() }).strict();

export interface ScopeTagRepository {
  list(owner: ScopeTagOwner, query: ScopeTagListQuery): Promise<Tag[]>;
  get(owner: ScopeTagOwner, tagKey: string): Promise<Tag | null>;
  resolveOwnedByNormalizedNames(owner: ScopeTagOwner, normalizedNames: string[]): Promise<Tag[]>;
  searchOwned(owner: ScopeTagOwner, embedding: number[], limit: number): Promise<RankedScopeTag[]>;
  create(owner: ScopeTagOwner, tag: Tag): Promise<Tag | null>;
  update(owner: ScopeTagOwner, tagKey: string, patch: Pick<Tag, 'name' | 'normalizedName' | 'embedding' | 'updatedAt'> & { description: string | null }): Promise<Tag | null>;
  delete(owner: ScopeTagOwner, tagKey: string): Promise<boolean>;
  setAssignments(owner: ScopeTagOwner, changes: ScopeTagAssignmentChange[], source: TagAssignment['source'], keys: string[], createdAt: string): Promise<Array<{ assignment: TagAssignment | null; changed: boolean }>>;
  resolveCandidateKeys(owner: ScopeTagOwner, tagKeys: string[], targetTypes: TagAssignment['sourceType'][], match: ScopeTagMatch): Promise<Record<string, string[]>>;
  resolveEmailThreadKeys(owner: ScopeTagOwner, messageKeys: string[]): Promise<string[]>;
  rankCandidateKeys(owner: ScopeTagOwner, targetType: TagAssignment['sourceType'], candidateKeys: string[], embedding: number[]): Promise<RankedScopeTagTarget[]>;
  listTargetTags(owner: ScopeTagOwner, targets: ScopeTagTarget[]): Promise<Record<string, ScopeTagProjection[]>>;
  listTargetAssignmentState(owner: ScopeTagOwner, targets: ScopeTagTarget[], tagKeys: string[]): Promise<ScopeTagTargetAssignmentState[]>;
  listAssignments(owner: ScopeTagOwner, query: ScopeTagAssignmentQuery): Promise<ScopeTagAssignmentProjection[]>;
  countAssignments(owner: ScopeTagOwner, query: ScopeTagAssignmentQuery): Promise<number>;
  getAssignment(owner: ScopeTagOwner, assignmentKey: string): Promise<ScopeTagAssignmentProjection | null>;
}

export function createScopeTagRepository(database: ScopeTagDatabase = db as unknown as ScopeTagDatabase, transact: ScopeTagTransactionRunner = defaultTransaction): ScopeTagRepository {
  return {
    async list(owner, input) {
      const authorization = input.target ? `${targetAccessQuery} FILTER readable` : 'LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"])';
      const cursor = await database.query(`${authorization} FOR tag IN tags FILTER tag.scopeKey == @scopeKey && tag.userKey == @userKey FILTER @sourceType == null || LENGTH(FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.tagKey == tag._key && assignment.sourceType == @sourceType && assignment.sourceKey == @sourceKey LIMIT 1 RETURN 1) > 0 FILTER @cursor == null || tag.normalizedName > @cursor.normalizedName || (tag.normalizedName == @cursor.normalizedName && tag._key > @cursor.key) SORT tag.normalizedName ASC, tag._key ASC LIMIT @limit RETURN tag`, { ...owner, sourceType: input.target?.type ?? null, sourceKey: input.target?.key ?? null, cursor: input.cursor ?? null, limit: input.limit });
      return (await cursor.all()).map(parseTag);
    },
    async get(owner, tagKey) { const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR tag IN tags FILTER tag._key == @tagKey && tag.scopeKey == @scopeKey && tag.userKey == @userKey LIMIT 1 RETURN tag', { ...owner, tagKey }); const value = await cursor.next(); return value ? parseTag(value) : null; },
    async resolveOwnedByNormalizedNames(owner, normalizedNames) {
      const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR tag IN tags FILTER tag.scopeKey == @scopeKey && tag.userKey == @userKey && tag.normalizedName IN @normalizedNames SORT tag.normalizedName ASC, tag._key ASC RETURN tag', { ...owner, normalizedNames });
      return (await cursor.all()).map(parseTag);
    },
    async searchOwned(owner, embedding, limit) {
      const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR tag IN tags FILTER tag.scopeKey == @scopeKey && tag.userKey == @userKey && IS_ARRAY(tag.embedding) && LENGTH(tag.embedding) == LENGTH(@embedding) LET score = COSINE_SIMILARITY(tag.embedding, @embedding) SORT score DESC, tag.normalizedName ASC, tag._key ASC LIMIT @limit RETURN MERGE(tag, { score })', { ...owner, embedding, limit });
      return (await cursor.all()).map((value) => {
        const row = value as Record<string, unknown>;
        return { ...parseTag(row), score: z.number().parse(row.score) };
      });
    },
    async create(owner, tag) {
      const valid = tagSchema.parse(tag);
      const cursor = await database.query(`LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) INSERT @tag IN tags RETURN NEW`, { ...owner, tag: toArangoDoc(valid) });
      const value = await cursor.next();
      return value ? parseTag(value) : null;
    },
    async update(owner, tagKey, patch) {
      const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR tag IN tags FILTER tag._key == @tagKey && tag.scopeKey == @scopeKey && tag.userKey == @userKey UPDATE tag WITH @patch IN tags OPTIONS { keepNull: false } RETURN NEW', { ...owner, tagKey, patch });
      const value = await cursor.next(); return value ? parseTag(value) : null;
    },
    delete(owner, tagKey) {
      return transact(async (trx) => {
        const cursor = await trx.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) LET tag = DOCUMENT(tags, @tagKey) FILTER tag != null && tag.scopeKey == @scopeKey && tag.userKey == @userKey LET removedAssignments = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.tagKey == @tagKey REMOVE assignment IN tagAssignments RETURN 1) REMOVE tag IN tags RETURN true', { ...owner, tagKey });
        return await cursor.next() === true;
      });
    },
    setAssignments(owner, changes, source, keys, createdAt) {
      return transact(async (trx) => {
        const targets = [...new Map(changes.map((change) => [`${change.target.type}\0${change.target.key}`, change.target])).values()];
        const tagKeys = [...new Set(changes.map((change) => change.tagKey))];
        const targetAccess = await trx.query(`${targetAccessPreludeQuery} FOR requestedTarget IN @targets ${batchTargetAccessRulesQuery} FILTER readable RETURN requestedTarget`, { ...owner, targets });
        if ((await targetAccess.all()).length !== targets.length) throw new ScopeTagRepositoryError('forbidden', 'Tag and readable target must belong to the authenticated user and scope.');
        const tagAccess = await trx.query('FOR tagKey IN @tagKeys LET tag = DOCUMENT(tags, tagKey) FILTER tag != null && tag.scopeKey == @scopeKey && tag.userKey == @userKey RETURN tagKey', { scopeKey: owner.scopeKey, userKey: owner.userKey, tagKeys });
        if ((await tagAccess.all()).length !== tagKeys.length) throw new ScopeTagRepositoryError('forbidden', 'Tag and readable target must belong to the authenticated user and scope.');

        const results: Array<{ assignment: TagAssignment | null; changed: boolean }> = changes.map(() => ({ assignment: null, changed: false }));
        const unassigned = changes.flatMap((change, index) => change.assigned ? [] : [{ index, tagKey: change.tagKey, sourceType: change.target.type, sourceKey: change.target.key }]);
        const removals: Array<{ index: number; key: string }> = [];
        if (unassigned.length) {
          const cursor = await trx.query('FOR change IN @changes LET assignment = FIRST(FOR candidate IN tagAssignments FILTER candidate.scopeKey == @scopeKey && candidate.tagKey == change.tagKey && candidate.sourceType == change.sourceType && candidate.sourceKey == change.sourceKey LIMIT 1 RETURN candidate) RETURN { index: change.index, assignment }', { scopeKey: owner.scopeKey, changes: unassigned });
          const rows = z.array(z.object({ index: z.number().int().nonnegative(), assignment: z.unknown().nullable() }).strict()).parse(await cursor.all());
          for (const row of rows) if (row.assignment) removals.push({ index: row.index, key: parseAssignment(row.assignment).key });
        }

        const assigned = changes.flatMap((change, index) => change.assigned ? [{ index, assignment: toArangoDoc(tagAssignmentSchema.parse({ key: keys[index], scopeKey: owner.scopeKey, tagKey: change.tagKey, sourceType: change.target.type, sourceKey: change.target.key, source, createdAt })) }] : []);
        if (assigned.length) {
          const cursor = await trx.query('FOR change IN @changes LET assignment = change.assignment UPSERT { scopeKey: assignment.scopeKey, tagKey: assignment.tagKey, sourceType: assignment.sourceType, sourceKey: assignment.sourceKey } INSERT assignment UPDATE {} IN tagAssignments RETURN { index: change.index, assignment: NEW, changed: OLD == null }', { changes: assigned });
          const rows = z.array(z.object({ index: z.number().int().nonnegative(), assignment: z.unknown(), changed: z.boolean() }).strict()).parse(await cursor.all());
          if (rows.length !== assigned.length) throw new ScopeTagRepositoryError('conflict', 'Tag assignment was not persisted.');
          for (const row of rows) results[row.index] = { assignment: parseAssignment(row.assignment), changed: row.changed };
        }

        if (removals.length) {
          const cursor = await trx.query('FOR removal IN @removals REMOVE removal.key IN tagAssignments RETURN { index: removal.index, assignment: OLD }', { removals });
          const rows = z.array(z.object({ index: z.number().int().nonnegative(), assignment: z.unknown() }).strict()).parse(await cursor.all());
          for (const row of rows) results[row.index] = { assignment: parseAssignment(row.assignment), changed: true };
        }
        return results;
      });
    },
    async resolveCandidateKeys(owner, tagKeys, targetTypes, match) {
      const cursor = await database.query(`LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) LET ownedTags = (FOR tag IN tags FILTER tag._key IN @tagKeys && tag.scopeKey == @scopeKey && tag.userKey == @userKey RETURN tag._key) FILTER LENGTH(ownedTags) == LENGTH(@tagKeys) FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.tagKey IN ownedTags && assignment.sourceType IN @targetTypes COLLECT sourceType = assignment.sourceType, sourceKey = assignment.sourceKey AGGREGATE matchedTags = COUNT_DISTINCT(assignment.tagKey) FILTER @match == "any" || matchedTags == LENGTH(ownedTags) SORT sourceType ASC, sourceKey ASC RETURN { sourceType, sourceKey }`, { ...owner, tagKeys, targetTypes, match });
      const rows = z.array(z.object({ sourceType: sourceTypeSchema, sourceKey: z.string().cuid() }).strict()).parse(await cursor.all());
      const result = Object.fromEntries(targetTypes.map((type) => [type, [] as string[]]));
      for (const row of rows) result[row.sourceType]!.push(row.sourceKey);
      return result;
    },
    async resolveEmailThreadKeys(owner, messageKeys) {
      if (!messageKeys.length) return [];
      const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR message IN emailMessages FILTER message._key IN @messageKeys && message.scopeKey == @scopeKey COLLECT threadKey = message.threadKey SORT threadKey ASC RETURN threadKey', { ...owner, messageKeys });
      return z.array(z.string().cuid()).parse(await cursor.all());
    },
    async rankCandidateKeys(owner, targetType, candidateKeys, embedding) {
      if (!candidateKeys.length) return [];
      const cursor = await database.query(`LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR sourceKey IN @candidateKeys LET target = @targetType == "folder" ? DOCUMENT(folders, sourceKey) : @targetType == "document" ? DOCUMENT(documents, sourceKey) : @targetType == "image-collection" ? DOCUMENT(collections, sourceKey) : @targetType == "image" ? DOCUMENT(images, sourceKey) : @targetType == "image-highlight" ? DOCUMENT(imageCollecitionHightlights, sourceKey) : @targetType == "image-memory" ? DOCUMENT(imageCollectionMemories, sourceKey) : @targetType == "place" ? DOCUMENT(places, sourceKey) : @targetType == "trip" ? DOCUMENT(trips, sourceKey) : @targetType == "email-inbox" ? DOCUMENT(emailInboxes, sourceKey) : @targetType == "email-tone" ? DOCUMENT(emailTones, sourceKey) : @targetType == "email-thread" ? DOCUMENT(emailThreads, sourceKey) : @targetType == "email-message" ? DOCUMENT(emailMessages, sourceKey) : @targetType == "email-draft" ? DOCUMENT(emailDrafts, sourceKey) : @targetType == "book" ? DOCUMENT(books, sourceKey) : null FILTER target != null && target.scopeKey == @scopeKey && IS_ARRAY(target.embedding) && LENGTH(target.embedding) == LENGTH(@embedding) LET score = COSINE_SIMILARITY(target.embedding, @embedding) SORT score DESC, sourceKey ASC RETURN { key: sourceKey, score }`, { ...owner, targetType, candidateKeys, embedding });
      return z.array(z.object({ key: z.string().cuid(), score: z.number() }).strict()).parse(await cursor.all());
    },
    async listTargetTags(owner, targets) {
      if (!targets.length) return {};
      const cursor = await database.query('LET membership = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET role = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && membership.status == "active" && membership.userId == @userKey && membership.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || role IN ["owner", "admin", "moderator", "viewer"]) FOR target IN @targets LET messageKeys = target.type == "email-thread" ? (FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == target.key RETURN message._key) : [] LET targetTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && ((assignment.sourceType == target.type && assignment.sourceKey == target.key) || (target.type == "email-thread" && assignment.sourceType == "email-message" && assignment.sourceKey IN messageKeys)) LET tag = DOCUMENT(tags, assignment.tagKey) FILTER tag != null && tag.scopeKey == @scopeKey && tag.userKey == @userKey SORT tag.normalizedName ASC, tag._key ASC RETURN DISTINCT { key: tag._key, name: tag.name }) RETURN { identity: CONCAT(target.type, "\\u0000", target.key), tags: targetTags }', { ...owner, targets });
      const rows = z.array(z.object({ identity: z.string(), tags: z.array(z.object({ key: z.string().cuid(), name: z.string() }).strict()) }).strict()).parse(await cursor.all());
      return Object.fromEntries(rows.map(({ identity, tags }) => [identity, tags]));
    },
    async listTargetAssignmentState(owner, targets, tagKeys) {
      const cursor = await database.query(`${targetAccessPreludeQuery} FOR requestedTarget IN @targets ${batchTargetAccessRulesQuery} FILTER readable LET assignedTagKeys = (FOR tagKey IN @tagKeys FILTER LENGTH(FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.tagKey == tagKey && assignment.sourceType == requestedTarget.type && assignment.sourceKey == requestedTarget.key LIMIT 1 RETURN 1) > 0 RETURN tagKey) RETURN { target: requestedTarget, tagKeys: assignedTagKeys }`, { ...owner, targets, tagKeys });
      const rows = z.array(z.object({ target: z.object({ type: sourceTypeSchema, key: z.string().cuid() }).strict(), tagKeys: z.array(z.string().cuid()) }).strict()).parse(await cursor.all());
      if (rows.length !== targets.length) throw new ScopeTagRepositoryError('forbidden', 'Every target must be readable in the authenticated scope.');
      return rows;
    },
    async listAssignments(owner, query) {
      const cursor = await database.query(`${assignmentProjectionQuery} LIMIT @limit RETURN { key: assignment._key, tag: { key: tag._key, name: tag.name }, target: { type: assignment.sourceType, key: assignment.sourceKey, label: TRIM(label) } }`, { ...owner, assignmentKey: null, tagKeys: query.tagKeys ?? null, tagMatch: query.tagMatch, targetTypes: query.targetTypes ?? null, limit: query.limit ?? 50 });
      return z.array(assignmentProjectionSchema).parse(await cursor.all());
    },
    async countAssignments(owner, query) {
      const cursor = await database.query(`${assignmentProjectionQuery} COLLECT WITH COUNT INTO count RETURN count`, { ...owner, assignmentKey: null, tagKeys: query.tagKeys ?? null, tagMatch: query.tagMatch, targetTypes: query.targetTypes ?? null });
      return z.number().int().nonnegative().parse(await cursor.next());
    },
    async getAssignment(owner, assignmentKey) {
      const cursor = await database.query(`${assignmentProjectionQuery} LIMIT 1 RETURN { key: assignment._key, tag: { key: tag._key, name: tag.name }, target: { type: assignment.sourceType, key: assignment.sourceKey, label: TRIM(label) } }`, { ...owner, assignmentKey, tagKeys: null, tagMatch: 'any', targetTypes: null });
      const value = await cursor.next();
      return value ? assignmentProjectionSchema.parse(value) : null;
    },
  };
}

export class ScopeTagRepositoryError extends Error {
  constructor(public readonly code: 'forbidden' | 'conflict', message: string) { super(message); this.name = 'ScopeTagRepositoryError'; }
}
export { isArangoUniqueConstraintError, sourceTypeSchema };
let defaultRepository: ScopeTagRepository | undefined;
export const getDefaultScopeTagRepository = () => defaultRepository ??= createScopeTagRepository();
