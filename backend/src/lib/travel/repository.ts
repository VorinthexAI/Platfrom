import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { db } from '@/lib/db/client';
import { placeSchema, type Place } from '@/lib/db/places.node';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { collectionMemberSchema, type CollectionMember } from '@/lib/db/collection-members.node';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { imageSchema, type Image } from '@/lib/db/images.node';
import { placeImageSchema, type PlaceImage } from '@/lib/db/place-images.node';
import { userHiddenSchema, type UserHidden } from '@/lib/db/user-hiddens.node';

export interface TravelAccessContext { organizationKey: string; scopeKey: string; userKey: string }
export interface TravelDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }
const readAuthorizationQuery = `
  LET membership = FIRST(FOR candidate IN userOrganizations
    FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
    LIMIT 1 RETURN candidate)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
    FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
    LIMIT 1 RETURN member.role)
  FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
  FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
  RETURN membership._key
`;
const writeAuthorizationQuery = readAuthorizationQuery.replace('["owner", "admin", "moderator", "member", "viewer"]', '["owner", "admin", "moderator"]');

async function authorizeRead(database: TravelDatabase, context: TravelAccessContext): Promise<void> {
  const rows = await (await database.query(readAuthorizationQuery, { ...context })).all();
  if (rows.length === 0) throw new TravelRepositoryError('forbidden');
}

export class TravelRepositoryError extends Error {
  constructor(readonly reason: 'forbidden') { super(reason); }
}

export interface TravelRepository {
  authorizeRead(context: TravelAccessContext): Promise<void>;
  authorizeWrite(context: TravelAccessContext): Promise<string>;
  overview(context: TravelAccessContext): Promise<Place[]>;
  create(context: TravelAccessContext, place: Place): Promise<Place>;
  convergeManagedPlace(input: { context: TravelAccessContext; place: Place; collection: Collection; member: CollectionMember; hidden: UserHidden; image: Image; collectionImage: CollectionImage; placeImage: PlaceImage }): Promise<Place>;
  compensateManagedImage(scopeKey: string, imageKey: string, now: string): Promise<string | null>;
  cancelManagedImageDeletion(storageKey: string): Promise<void>;
  acknowledgeManagedImageDeletion(storageKey: string): Promise<void>;
}

export function createTravelRepository(database: TravelDatabase = db): TravelRepository {
  return {
    authorizeRead(context) {
      return authorizeRead(database, context);
    },
    async authorizeWrite(context) {
      const rows = await (await database.query(writeAuthorizationQuery, { ...context })).all();
      if (rows.length === 0) throw new TravelRepositoryError('forbidden');
      return String(rows[0]);
    },
    async overview(context) {
      await authorizeRead(database, context);
      const cursor = await database.query('FOR place IN places FILTER place.scopeKey == @scopeKey SORT place.name ASC, place._key ASC RETURN place', { scopeKey: context.scopeKey });
      return (await cursor.all()).map((place) => placeSchema.parse(withArangoKey(place as Record<string, unknown>)));
    },
    async create(context, place) {
      const valid = placeSchema.parse(place);
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations
          FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
          LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
          FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
          LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
        UPSERT { scopeKey: @scopeKey, countryCode: @countryCode, name: @name }
          INSERT @place UPDATE {} IN places RETURN NEW
      `, { ...context, countryCode: valid.countryCode, name: valid.name, place: toArangoDoc(valid) });
      const saved = (await cursor.all())[0];
      if (!saved) throw new TravelRepositoryError('forbidden');
      return placeSchema.parse(withArangoKey(saved as Record<string, unknown>));
    },
    async convergeManagedPlace(input) {
      const place = placeSchema.parse(input.place);
      const collection = collectionSchema.parse(input.collection);
      const member = collectionMemberSchema.parse(input.member);
      const hidden = userHiddenSchema.parse(input.hidden);
      const image = imageSchema.parse(input.image);
      const collectionImage = collectionImageSchema.parse(input.collectionImage);
      const placeImage = placeImageSchema.parse(input.placeImage);
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR candidate IN scopeMembers FILTER candidate.scopeKey == @scopeKey && candidate.userOrganizationKey == membership._key && candidate.status == "active" LIMIT 1 RETURN candidate.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
        LET savedPlace = FIRST(UPSERT { scopeKey: @scopeKey, countryCode: @countryCode, name: @name } INSERT @place UPDATE { summary: @summary, latitude: @latitude, longitude: @longitude, embedding: @placeEmbedding } IN places RETURN NEW)
        LET savedCollectionState = FIRST(UPSERT { scopeKey: @scopeKey, purpose: "place-media" } INSERT @collection UPDATE { mutationPolicy: "system-only", purpose: "place-media" } IN collections RETURN { collection: NEW, created: OLD == null })
        LET savedCollection = savedCollectionState.collection
        LET initialMembers = savedCollectionState.created ? (FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.status == "active" LET candidateScopeRole = FIRST(FOR scoped IN scopeMembers FILTER scoped.scopeKey == @scopeKey && scoped.userOrganizationKey == candidate._key && scoped.status == "active" LIMIT 1 RETURN scoped.role) FILTER candidate.orgRole IN ["owner", "admin"] || candidateScopeRole IN ["owner", "admin", "moderator", "member", "viewer"] UPSERT { scopeKey: @scopeKey, collectionKey: savedCollection._key, memberKey: candidate._key } INSERT { _key: CONCAT("c", SUBSTRING(SHA256(CONCAT("place-media-member\u0000", savedCollection._key, "\u0000", candidate._key)), 0, 24)), scopeKey: @scopeKey, collectionKey: savedCollection._key, memberKey: candidate._key, role: "viewer", createdAt: @createdAt } UPDATE { role: "viewer" } IN collectionMembers RETURN candidate) : []
        LET initialHiddens = savedCollectionState.created ? (FOR candidate IN initialMembers UPSERT { userKey: candidate.userId, source: "collection", sourceKey: savedCollection._key } INSERT { _key: CONCAT("c", SUBSTRING(SHA256(CONCAT("place-media-hidden\u0000", candidate.userId, "\u0000", savedCollection._key)), 0, 24)), userKey: candidate.userId, source: "collection", sourceKey: savedCollection._key, createdAt: @createdAt } UPDATE {} IN userHiddens RETURN NEW) : []
        LET savedMember = FIRST(UPSERT { scopeKey: @scopeKey, collectionKey: savedCollection._key, memberKey: membership._key } INSERT MERGE(@member, { collectionKey: savedCollection._key, memberKey: membership._key }) UPDATE { role: "viewer" } IN collectionMembers RETURN NEW)
        LET savedCollectionImage = FIRST(UPSERT { scopeKey: @scopeKey, collectionKey: savedCollection._key, imageKey: @imageKey } INSERT MERGE(@collectionImage, { collectionKey: savedCollection._key }) UPDATE {} IN collectionImages RETURN NEW)
        LET savedPlaceImage = FIRST(UPSERT { scopeKey: @scopeKey, imageKey: @imageKey } INSERT MERGE(@placeImage, { placeKey: savedPlace._key }) UPDATE { placeKey: savedPlace._key } IN placeImages RETURN NEW)
        RETURN savedPlace
      `, {
        ...input.context, countryCode: place.countryCode, name: place.name, summary: place.summary, latitude: place.latitude, longitude: place.longitude, createdAt: place.createdAt,
        placeEmbedding: place.embedding, place: toArangoDoc(place), collection: toArangoDoc(collection), member: toArangoDoc(member), hidden: toArangoDoc(hidden),
        imageKey: image.key, collectionImage: toArangoDoc(collectionImage), placeImage: toArangoDoc(placeImage),
      });
      const saved = (await cursor.all())[0];
      if (!saved) throw new TravelRepositoryError('forbidden');
      return placeSchema.parse(withArangoKey(saved as Record<string, unknown>));
    },
    async compensateManagedImage(scopeKey, imageKey, now) {
      const cursor = await database.query(`
        LET image = DOCUMENT(images, @imageKey)
        FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy == "system-only"
        LET linked = LENGTH(FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey LIMIT 1 RETURN 1)
        FILTER linked == 0
        LET storage = image.storageKey
        LET captionKey = image.imageCaptionKey
        REMOVE image IN images
        UPSERT { storageKey: storage } INSERT { storageKey: storage, createdAt: @now } UPDATE {} IN storageDeletionJobs
        LET removedCaption = captionKey == null ? [] : (FOR caption IN imageCaptions FILTER caption._key == captionKey FILTER LENGTH(FOR retained IN images FILTER retained.imageCaptionKey == captionKey LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions RETURN OLD)
        RETURN storage
      `, { scopeKey, imageKey, now });
      const rows = await cursor.all();
      return typeof rows[0] === 'string' ? rows[0] : null;
    },
    async cancelManagedImageDeletion(storageKey) {
      await database.query('FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey REMOVE job IN storageDeletionJobs', { storageKey });
    },
    async acknowledgeManagedImageDeletion(storageKey) {
      await database.query('FOR job IN storageDeletionJobs FILTER job.storageKey == @storageKey REMOVE job IN storageDeletionJobs', { storageKey });
    },
  };
}
