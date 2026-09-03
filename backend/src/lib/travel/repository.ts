import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { db, withTransaction } from '@/lib/db/client';
import { placeSchema, type Place } from '@/lib/db/places.node';
import { tripSchema, type Trip } from '@/lib/db/trips.node';
import { tripPlaceSchema, type TripPlace } from '@/lib/db/trip-places.node';
import { tripAttachmentSchema, type TripAttachment } from '@/lib/db/trip-attachments.node';
import { tripCreationReceiptSchema, type TripCreationReceipt } from '@/lib/db/trip-creation-receipts.node';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { generatedDocumentBindingSchema, type GeneratedDocumentBinding } from '@/lib/db/generated-document-bindings.node';
import { generatedDocumentFolderKeys } from '@/lib/generated-documents/folders';
import { tripGuideSchema, type TripGuide } from '@/lib/db/trip-guides.node';
import { placeReferenceSchema, type PlaceReference } from '@/lib/db/place-references.node';
import { placeHeroMediaSchema, type PlaceHeroMedia } from '@/lib/db/place-hero-media.node';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { ensureGeneratedDocumentFolders } from '@/lib/generated-documents/folders';
import { z } from 'zod';

export interface TravelAccessContext { organizationKey: string; scopeKey: string; userKey: string }
export interface TravelCreationDateRange { createdFrom?: string; createdTo?: string }
export interface PlacePresentationRecord { place: Place; heroStorageKey?: string; trips?: Array<{ key: string; name: string }> }
export interface TripPresentationRecord { trip: Trip; places: Place[]; placeHeroStorageKeys: Array<string | null>; attachments: TripAttachment[]; accessibleCoverImageKey?: string; coverStorageKey?: string }
export interface TripGuideSource { trip: Trip; places: Place[] }
export interface GeneratedDocumentRecord { document: Document; binding: GeneratedDocumentBinding }
export type TravelGeneratedRecord = TripGuide | PlaceReference;
export interface GalleryExportCollection { key: string; scopeKey: string; ownerKey: string; memberKey: string; name: string; embedding: number[]; createdAt: string; updatedAt: string }
export interface TravelDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }
type TravelTransactionRunner = <T>(collections: { read: string[]; write: string[] }, operation: (transaction: TravelDatabase) => Promise<T>) => Promise<T>;
const runTravelTransaction: TravelTransactionRunner = (collections, operation) => withTransaction(collections, (transaction) => operation(transaction));
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
const writeAuthorizationQuery = readAuthorizationQuery.replace('["owner", "admin", "moderator", "member", "viewer"]', '["owner", "admin", "moderator", "member"]');
const writeAuthorizationFilter = writeAuthorizationQuery.replace('RETURN membership._key', '');

async function authorizeRead(database: TravelDatabase, context: TravelAccessContext): Promise<void> {
  const rows = await (await database.query(readAuthorizationQuery, { ...context })).all();
  if (rows.length === 0) throw new TravelRepositoryError('forbidden');
}

export class TravelRepositoryError extends Error {
  constructor(readonly reason: 'forbidden' | 'conflict' | 'favorite' | 'gone') { super(reason); }
}

export interface TravelRepository {
  authorizeRead(context: TravelAccessContext): Promise<void>;
  authorizeWrite(context: TravelAccessContext): Promise<string>;
  overview(context: TravelAccessContext): Promise<{ places: PlacePresentationRecord[]; recentPlaces: PlacePresentationRecord[] }>;
  open(context: TravelAccessContext, countryCode: string, name: string, openedAt: string): Promise<Place>;
  findGenerated(context: TravelAccessContext, countryCode: string | undefined, name: string): Promise<Place | null>;
  upsertGenerated(context: TravelAccessContext, place: Place): Promise<Place>;
  create(context: TravelAccessContext, place: Place): Promise<Place>;
  updatePlace(context: TravelAccessContext, placeKey: string, patch: { status?: 'wishlist' | 'visited'; isFavorite?: boolean }): Promise<PlacePresentationRecord>;
  deletePlace(context: TravelAccessContext, placeKey: string, updatedAt: string): Promise<{ placeKey: string }>;
  searchPlaces(context: TravelAccessContext, embedding: number[], dateRange?: TravelCreationDateRange): Promise<PlacePresentationRecord[]>;
  createTrip(context: TravelAccessContext, trip: Trip, relations: TripPlace[], receipt: TripCreationReceipt): Promise<TripPresentationRecord>;
  tripSemanticSourceForUpdate(context: TravelAccessContext, tripKey: string): Promise<{ name: string; description?: string }>;
  updateTrip(context: TravelAccessContext, tripKey: string, patch: { name?: string; description?: string | null; coverImageKey?: string | null; isFavorite?: boolean; status?: 'planned' | 'completed'; embedding?: number[]; embeddingContentVersion?: 1 }, relations: TripPlace[] | undefined, updatedAt: string): Promise<TripPresentationRecord>;
  deleteTrip(context: TravelAccessContext, tripKey: string): Promise<{ tripKey: string }>;
  setTripAttachments(context: TravelAccessContext, tripKey: string, attachments: TripAttachment[], updatedAt: string): Promise<TripPresentationRecord>;
  listTrips(context: TravelAccessContext): Promise<TripPresentationRecord[]>;
  searchTrips(context: TravelAccessContext, embedding: number[], dateRange?: TravelCreationDateRange): Promise<TripPresentationRecord[]>;
  prepareTripGuide(context: TravelAccessContext, guideKey: string, tripKey: string, requestHash: string): Promise<{ existing?: TripGuide; source?: TripGuideSource }>;
  preparePlaceReference(context: TravelAccessContext, referenceKey: string, placeKey: string, kind: 'brief' | 'accommodations' | 'restaurants' | 'activities', requestHash: string): Promise<{ existing?: PlaceReference; place?: Place }>;
  persistGeneratedContent(context: TravelAccessContext, record: TravelGeneratedRecord): Promise<TravelGeneratedRecord>;
  listTripGuides(context: TravelAccessContext, tripKey: string): Promise<TripGuide[]>;
  listPlaceReferences(context: TravelAccessContext, placeKey: string, kind: PlaceReference['kind']): Promise<PlaceReference[]>;
  copyGeneratedDocument(context: TravelAccessContext, record: GeneratedDocumentRecord): Promise<void>;
  ensureGalleryExportCollection(context: TravelAccessContext, collection: GalleryExportCollection): Promise<void>;
  linkGalleryExport(context: TravelAccessContext, relation: CollectionImage): Promise<void>;
  convergePlace(input: { context: TravelAccessContext; place: Place; hero: PlaceHeroMedia }): Promise<PlacePresentationRecord>;
}

export function createTravelRepository(database: TravelDatabase = db, transaction: TravelTransactionRunner = runTravelTransaction): TravelRepository {
  const parseTripPresentation = (raw: unknown): TripPresentationRecord => {
    const row = z.object({ trip: z.record(z.unknown()), places: z.array(z.unknown()), attachments: z.array(z.record(z.unknown())).default([]), accessibleCoverImageKey: z.string().cuid().nullable().optional(), coverStorageKey: z.string().trim().min(1).nullable().optional() }).parse(raw);
    const placeRowSchema = z.object({ place: z.record(z.unknown()), heroStorageKey: z.string().trim().min(1).nullable().optional() });
    const placeRows = row.places.map((value) => placeRowSchema.safeParse(value).data ?? { place: z.record(z.unknown()).parse(value), heroStorageKey: null });
    return {
      trip: tripSchema.parse(withArangoKey(row.trip)),
      places: placeRows.map(({ place }) => placeSchema.parse(withArangoKey(place))),
      placeHeroStorageKeys: placeRows.map(({ heroStorageKey }) => heroStorageKey ?? null),
      attachments: row.attachments.map((attachment) => tripAttachmentSchema.parse(withArangoKey(attachment))),
      ...(row.accessibleCoverImageKey ? { accessibleCoverImageKey: row.accessibleCoverImageKey } : {}),
      ...(row.coverStorageKey ? { coverStorageKey: row.coverStorageKey } : {}),
    };
  };
  const repository: TravelRepository = {
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
      const bindVars = { scopeKey: context.scopeKey, userKey: context.userKey };
      const [placesCursor, recentCursor] = await Promise.all([
        database.query('FOR place IN places FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true SORT place.name ASC, place._key ASC LET hero = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media) RETURN { place, heroStorageKey: hero == null ? null : hero.storageKey }', bindVars),
        database.query('FOR place IN places FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && place.openedAt != null && place.generatedDetail != null SORT place.openedAt DESC, place._key ASC LIMIT 25 LET hero = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media) RETURN { place, heroStorageKey: hero == null ? null : hero.storageKey }', bindVars),
      ]);
      const parse = (raw: unknown): PlacePresentationRecord => {
        const row = z.object({ place: z.record(z.unknown()), heroStorageKey: z.string().trim().min(1).nullable().optional() }).parse(raw);
        return { place: placeSchema.parse(withArangoKey(row.place)), ...(row.heroStorageKey ? { heroStorageKey: row.heroStorageKey } : {}) };
      };
      return { places: (await placesCursor.all()).map(parse), recentPlaces: (await recentCursor.all()).map(parse) };
    },
    async open(context, countryCode, name, openedAt) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations
          FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
          LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
          FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
          LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
        FOR place IN places
          FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && place.countryCode == @countryCode && place.name == @name && place.generatedDetail != null
          LIMIT 1 UPDATE place WITH { openedAt: @openedAt } IN places RETURN NEW
      `, { ...context, countryCode, name, openedAt });
      const opened = (await cursor.all())[0];
      if (!opened) throw new TravelRepositoryError('forbidden');
      return placeSchema.parse(withArangoKey(opened as Record<string, unknown>));
    },
    async findGenerated(context, countryCode, name) {
      const cursor = await database.query(`
        FOR place IN places
          FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && (@countryCode == null || place.countryCode == @countryCode) && place.name == @name
          LIMIT 1 RETURN place
      `, { scopeKey: context.scopeKey, userKey: context.userKey, countryCode, name });
      const found = (await cursor.all())[0];
      return found ? placeSchema.parse(withArangoKey(found as Record<string, unknown>)) : null;
    },
    async upsertGenerated(context, place) {
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
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name }
          INSERT @place
          UPDATE {
            kind: @kind, summary: @summary, latitude: @latitude, longitude: @longitude,
            embedding: @embedding, embeddingContentVersion: 2, generatedDetail: @generatedDetail, generatedDetailVersion: @generatedDetailVersion
          } IN places
          RETURN NEW
      `, { ...context, countryCode: valid.countryCode, name: valid.name, kind: valid.kind, summary: valid.summary, latitude: valid.latitude, longitude: valid.longitude, embedding: valid.embedding, generatedDetail: valid.generatedDetail, generatedDetailVersion: valid.generatedDetailVersion, place: toArangoDoc(valid) });
      const saved = (await cursor.all())[0];
      if (!saved) throw new TravelRepositoryError('forbidden');
      return placeSchema.parse(withArangoKey(saved as Record<string, unknown>));
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
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name }
          INSERT @place UPDATE {} IN places RETURN NEW
      `, { ...context, countryCode: valid.countryCode, name: valid.name, place: toArangoDoc(valid) });
      const saved = (await cursor.all())[0];
      if (!saved) throw new TravelRepositoryError('forbidden');
      return placeSchema.parse(withArangoKey(saved as Record<string, unknown>));
    },
    async updatePlace(context, placeKey, patch) {
      const result = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers', 'placeHeroMedia'],
        write: ['places'],
      }, async (executor) => {
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations
            FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
            LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
            FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
            LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET place = DOCUMENT(places, @placeKey)
          FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
          LET changed = (@setStatus && (place.status IN ["wishlist", "visited"] ? place.status : "wishlist") != @status)
            || (@setFavorite && (place.isFavorite == true) != @isFavorite)
          LET updated = !changed ? [] : (UPDATE place WITH @patch IN places RETURN NEW)
          LET savedPlace = changed ? FIRST(updated) : place
          RETURN savedPlace
        `, { ...context, placeKey, patch, setStatus: patch.status !== undefined, status: patch.status ?? null, setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false });
        const raw = (await cursor.all())[0];
        if (!raw) return null;
        const heroCursor = await executor.query(`
          FOR media IN placeHeroMedia
            FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == @placeKey
            LIMIT 1
            RETURN media.storageKey
        `, { scopeKey: context.scopeKey, userKey: context.userKey, placeKey });
        return { raw, heroStorageKey: (await heroCursor.all())[0] };
      });
      const raw = result?.raw;
      if (!raw) throw new TravelRepositoryError('forbidden');
      const place = placeSchema.parse(withArangoKey(raw as Record<string, unknown>));
      const heroStorageKey = z.string().trim().min(1).safeParse(result?.heroStorageKey).data;
      return { place, ...(heroStorageKey ? { heroStorageKey } : {}) };
    },
    async deletePlace(context, placeKey, updatedAt) {
      z.string().datetime().parse(updatedAt);
      const result = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers', 'places'],
        write: ['places', 'placeHeroMedia', 'placeReferences', 'tripPlaces', 'trips', 'storageDeletionJobs'],
      }, async (executor) => {
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET place = DOCUMENT(places, @placeKey)
          FILTER place == null || (place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true)
          RETURN place == null ? "deleted" : "deletable"
        `, { ...context, placeKey });
        const status = (await cursor.all())[0];
        if (status === 'deleted') return 'deleted' as const;
        if (status !== 'deletable') return 'forbidden' as const;
        const affectedTrips = await executor.query('FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.placeKey == @placeKey RETURN DISTINCT relation.tripKey', { scopeKey: context.scopeKey, placeKey });
        const tripKeys = (await affectedTrips.all()).map(String);
        await executor.query('FOR reference IN placeReferences FILTER reference.scopeKey == @scopeKey && reference.userKey == @userKey && reference.placeKey == @placeKey REMOVE reference IN placeReferences', { scopeKey: context.scopeKey, userKey: context.userKey, placeKey });
        const heroCursor = await executor.query('FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == @placeKey RETURN media.storageKey', { scopeKey: context.scopeKey, userKey: context.userKey, placeKey });
        const heroStorageKeys = (await heroCursor.all()).map(String);
        if (heroStorageKeys.length > 0) await executor.query('FOR storageKey IN @storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @updatedAt } UPDATE {} IN storageDeletionJobs', { storageKeys: heroStorageKeys, updatedAt });
        await executor.query('FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == @placeKey REMOVE media IN placeHeroMedia', { scopeKey: context.scopeKey, userKey: context.userKey, placeKey });
        await executor.query('FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.placeKey == @placeKey REMOVE relation IN tripPlaces', { scopeKey: context.scopeKey, placeKey });
        if (tripKeys.length > 0) await executor.query('FOR trip IN trips FILTER trip._key IN @tripKeys && trip.scopeKey == @scopeKey && trip.userKey == @userKey UPDATE trip WITH { updatedAt: @updatedAt } IN trips', { scopeKey: context.scopeKey, userKey: context.userKey, tripKeys, updatedAt });
        await executor.query('REMOVE @placeKey IN places', { placeKey });
        return 'deleted' as const;
      });
      if (result !== 'deleted') throw new TravelRepositoryError('forbidden');
      return { placeKey };
    },
    async searchPlaces(context, embedding, dateRange = {}) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
        FOR place IN places
          FILTER place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
          FILTER @createdFrom == null || place.createdAt >= @createdFrom
          FILTER @createdTo == null || place.createdAt <= @createdTo
          FILTER IS_ARRAY(place.embedding) && LENGTH(place.embedding) == @dimensions && LENGTH(place.embedding[* FILTER !IS_NUMBER(CURRENT)]) == 0
          LET score = COSINE_SIMILARITY(place.embedding, @embedding)
          SORT score DESC, place._key ASC
          LET heroStorageKey = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey)
          LET parentTrips = (FOR relation IN tripPlaces
            FILTER relation.scopeKey == @scopeKey && relation.placeKey == place._key
            FOR trip IN trips
              FILTER trip._key == relation.tripKey && trip.scopeKey == @scopeKey && trip.userKey == @userKey
              SORT trip.name ASC, trip._key ASC
              RETURN { key: trip._key, name: trip.name })
          RETURN { place, heroStorageKey, trips: parentTrips }
      `, { ...context, embedding, dimensions: embedding.length, createdFrom: dateRange.createdFrom ?? null, createdTo: dateRange.createdTo ?? null });
      return (await cursor.all()).map((raw) => {
        const row = z.object({ place: z.record(z.unknown()), heroStorageKey: z.string().trim().min(1).nullable().optional(), trips: z.array(z.object({ key: z.string().cuid(), name: z.string().trim().min(1) }).strict()).default([]) }).parse(raw);
        return { place: placeSchema.parse(withArangoKey(row.place)), ...(row.heroStorageKey ? { heroStorageKey: row.heroStorageKey } : {}), ...(row.trips.length ? { trips: row.trips } : {}) };
      });
    },
    async createTrip(context, trip, relations, receipt) {
      const validTrip = tripSchema.parse(trip);
      const validRelations = relations.map((relation) => tripPlaceSchema.parse(relation));
      const validReceipt = tripCreationReceiptSchema.parse(receipt);
      if (!validTrip.requestHash || validTrip.scopeKey !== context.scopeKey || validTrip.userKey !== context.userKey
        || validReceipt.key !== validTrip.key || validReceipt.tripKey !== validTrip.key || validReceipt.scopeKey !== context.scopeKey || validReceipt.userKey !== context.userKey || validReceipt.requestHash !== validTrip.requestHash
        || validRelations.length === 0
        || validRelations.some((relation, position) => relation.scopeKey !== context.scopeKey || relation.tripKey !== validTrip.key || relation.position !== position)) {
        throw new TravelRepositoryError('forbidden');
      }
      const result = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers', 'places', 'images', 'placeHeroMedia', 'tripAttachments', 'folders', 'collections', 'collectionMembers', 'collectionImages'],
        write: ['tripCreationReceipts', 'trips', 'tripPlaces'],
      }, async (executor) => {
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
          LET receipt = DOCUMENT(tripCreationReceipts, @tripKey)
          LET trip = DOCUMENT(trips, @tripKey)
          LET requestedPlaces = receipt == null ? (FOR placeKey IN @placeKeys LET place = DOCUMENT(places, placeKey) FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true LET hero = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey) RETURN { place, heroStorageKey: hero }) : []
          LET persistedPlaces = receipt != null && trip != null ? (FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == trip._key SORT relation.position ASC, relation._key ASC LET place = DOCUMENT(places, relation.placeKey) FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true LET hero = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey) RETURN { place, heroStorageKey: hero }) : []
          LET places = receipt == null ? requestedPlaces : persistedPlaces
          LET attachments = receipt != null && trip != null ? (FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.tripKey == trip._key SORT attachment.position ASC, attachment._key ASC LET folder = attachment.targetType == "folder" ? DOCUMENT(folders, attachment.targetKey) : null LET collection = attachment.targetType == "collection" ? DOCUMENT(collections, attachment.targetKey) : null LET collectionAccess = collection == null ? false : elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 FILTER (attachment.targetType == "folder" && folder != null && folder.scopeKey == @scopeKey && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null)) || (attachment.targetType == "collection" && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && collection.purpose == null && collectionAccess) RETURN attachment) : []
          LET customCover = trip == null || trip.coverImageKey == null ? null : DOCUMENT(images, trip.coverImageKey)
          LET coverCollections = customCover == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == customCover._key LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey RETURN collection._key)
          LET coverAccessible = customCover != null && customCover.scopeKey == @scopeKey && (elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN coverCollections && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 || (LENGTH(coverCollections) == 0 && customCover.createdByKey == membership._key))
          LET firstHeroStorageKey = FIRST(places).heroStorageKey
          RETURN { receipt, trip, places, attachments, accessibleCoverImageKey: coverAccessible ? customCover._key : null, coverStorageKey: coverAccessible ? customCover.storageKey : firstHeroStorageKey }
        `, { ...context, tripKey: validTrip.key, placeKeys: validRelations.map(({ placeKey }) => placeKey) });
        const preloaded = (await cursor.all())[0] as Record<string, unknown> | undefined;
        if (!preloaded) throw new TravelRepositoryError('forbidden');
        const existingReceipt = preloaded.receipt as Record<string, unknown> | null;
        const existingTrip = preloaded.trip as Record<string, unknown> | null;
        if (existingReceipt) {
          const parsedReceipt = tripCreationReceiptSchema.parse(withArangoKey(existingReceipt));
          if (parsedReceipt.scopeKey !== context.scopeKey || parsedReceipt.userKey !== context.userKey || parsedReceipt.requestHash !== validTrip.requestHash) throw new TravelRepositoryError('conflict');
          if (!existingTrip) throw new TravelRepositoryError('gone');
          return preloaded;
        }
        if (existingTrip) throw new TravelRepositoryError('conflict');
        if ((preloaded.places as unknown[]).length !== validRelations.length) throw new TravelRepositoryError('forbidden');
        await executor.query('INSERT @receipt IN tripCreationReceipts', { receipt: toArangoDoc(validReceipt) });
        await executor.query('INSERT @trip IN trips', { trip: toArangoDoc(validTrip) });
        await executor.query('FOR relation IN @relations INSERT relation IN tripPlaces', { relations: validRelations.map(toArangoDoc) });
        return { ...preloaded, trip: toArangoDoc(validTrip) };
      });
      return parseTripPresentation(result);
    },
    async tripSemanticSourceForUpdate(context, tripKey) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
        LET trip = DOCUMENT(trips, @tripKey)
        FILTER trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey
        RETURN { name: trip.name, description: trip.description }
      `, { ...context, tripKey });
      const row = (await cursor.all())[0];
      if (!row) throw new TravelRepositoryError('forbidden');
      const source = z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).nullable().optional() }).parse(row);
      return { name: source.name, ...(source.description ? { description: source.description } : {}) };
    },
    async updateTrip(context, tripKey, patch, relations, updatedAt) {
      z.string().datetime().parse(updatedAt);
      const validRelations = relations?.map((relation) => tripPlaceSchema.parse(relation));
      if (validRelations?.some((relation, position) => relation.scopeKey !== context.scopeKey || relation.tripKey !== tripKey || relation.position !== position)) throw new TravelRepositoryError('forbidden');
      const updated = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers', 'trips', 'images', 'collectionImages', 'collections', 'collectionMembers', 'tripAttachments', 'folders', 'placeHeroMedia'],
        write: ['trips', 'tripPlaces', 'places'],
      }, async (executor) => {
        const mutation = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET trip = DOCUMENT(trips, @tripKey)
          FILTER trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey
          LET currentPlaceKeys = (FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey SORT relation.position ASC, relation._key ASC RETURN relation.placeKey)
          LET selectedPlaces = @replacePlaces ? (FOR placeKey IN @placeKeys LET place = DOCUMENT(places, placeKey) FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true RETURN place) : []
          FILTER !@replacePlaces || (LENGTH(UNIQUE(@placeKeys)) == LENGTH(@placeKeys) && LENGTH(selectedPlaces) == LENGTH(@placeKeys))
          LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
          LET coverCollections = cover == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == cover._key LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey RETURN collection._key)
          LET coverAccessible = cover != null && cover.scopeKey == @scopeKey && (membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN coverCollections && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 || (LENGTH(coverCollections) == 0 && cover.createdByKey == membership._key))
          FILTER !@setCover || @coverImageKey == null || coverAccessible
          LET changedPlaces = @replacePlaces && currentPlaceKeys != @placeKeys
          LET changed = changedPlaces || (@setName && trip.name != @name) || (@setDescription && (HAS(trip, "description") ? trip.description : null) != @description) || (@setCover && (HAS(trip, "coverImageKey") ? trip.coverImageKey : null) != @coverImageKey) || (@setFavorite && (trip.isFavorite == true) != @isFavorite) || (@setStatus && (trip.status IN ["planned", "completed"] ? trip.status : "planned") != @status)
          LET updated = !changed ? [] : (UPDATE trip WITH MERGE(@patch, { updatedAt: @updatedAt }) IN trips OPTIONS { keepNull: false } RETURN NEW)
          RETURN { trip: changed ? FIRST(updated) : trip, changed, changedPlaces }
        `, { ...context, tripKey, patch, updatedAt, replacePlaces: validRelations !== undefined, placeKeys: validRelations?.map(({ placeKey }) => placeKey) ?? [], setName: patch.name !== undefined, name: patch.name ?? null, setDescription: Object.prototype.hasOwnProperty.call(patch, 'description'), description: patch.description ?? null, setCover: Object.prototype.hasOwnProperty.call(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null, setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false, setStatus: patch.status !== undefined, status: patch.status ?? null });
        const mutationState = (await mutation.all())[0] as { changed?: boolean; changedPlaces?: boolean } | undefined;
        if (!mutationState) throw new TravelRepositoryError('forbidden');
        if (validRelations && mutationState.changedPlaces) {
          await executor.query('FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey REMOVE relation IN tripPlaces', { scopeKey: context.scopeKey, tripKey });
          await executor.query('FOR relation IN @relations INSERT relation IN tripPlaces', { relations: validRelations.map(toArangoDoc) });
        }
        if (patch.status === 'completed') {
          await executor.query(`
            FOR relation IN tripPlaces
              FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey
              LET place = DOCUMENT(places, relation.placeKey)
              FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
              FILTER (place.status IN ["wishlist", "visited"] ? place.status : "wishlist") != "visited"
              UPDATE place WITH { status: "visited" } IN places
          `, { scopeKey: context.scopeKey, userKey: context.userKey, tripKey });
        }
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scopeRole = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
          LET trip = DOCUMENT(trips, @tripKey)
          LET places = (FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey SORT relation.position ASC, relation._key ASC LET place = DOCUMENT(places, relation.placeKey) FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true LET heroStorageKey = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey) RETURN { place, heroStorageKey })
          LET attachments = (FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.tripKey == @tripKey SORT attachment.position ASC, attachment._key ASC LET folder = attachment.targetType == "folder" ? DOCUMENT(folders, attachment.targetKey) : null LET collection = attachment.targetType == "collection" ? DOCUMENT(collections, attachment.targetKey) : null LET collectionAccess = collection == null ? false : elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 FILTER (attachment.targetType == "folder" && folder != null && folder.scopeKey == @scopeKey && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null)) || (attachment.targetType == "collection" && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && collection.purpose == null && collectionAccess) RETURN attachment)
          LET heroStorageKey = FIRST(places).heroStorageKey
          LET customCover = trip.coverImageKey == null ? null : DOCUMENT(images, trip.coverImageKey)
          LET coverCollections = customCover == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == customCover._key LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey RETURN collection._key)
          LET coverAccessible = customCover != null && customCover.scopeKey == @scopeKey && (elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN coverCollections && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 || (LENGTH(coverCollections) == 0 && customCover.createdByKey == membership._key))
          RETURN { trip, places, attachments, accessibleCoverImageKey: coverAccessible ? customCover._key : null, coverStorageKey: coverAccessible ? customCover.storageKey : heroStorageKey }
        `, { ...context, tripKey });
        return (await cursor.all())[0];
      });
      if (!updated) throw new TravelRepositoryError('forbidden');
      return parseTripPresentation(updated);
    },
    async deleteTrip(context, tripKey) {
      const result = await transaction({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'tripCreationReceipts'], write: ['trips', 'tripPlaces', 'tripAttachments', 'tripGuides'] }, async (executor) => {
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET trip = DOCUMENT(trips, @tripKey)
          LET receipt = DOCUMENT(tripCreationReceipts, @tripKey)
          FILTER (trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey) || (trip == null && receipt != null && receipt.scopeKey == @scopeKey && receipt.userKey == @userKey)
          RETURN trip == null ? "deleted" : trip.isFavorite == true ? "favorite" : "deletable"
        `, { ...context, tripKey });
        const status = (await cursor.all())[0];
        if (status === 'favorite') return 'favorite' as const;
        if (status === 'deleted') return 'deleted' as const;
        if (status !== 'deletable') return 'forbidden' as const;
        await executor.query('FOR guide IN tripGuides FILTER guide.scopeKey == @scopeKey && guide.userKey == @userKey && guide.tripKey == @tripKey REMOVE guide IN tripGuides', { scopeKey: context.scopeKey, userKey: context.userKey, tripKey });
        await executor.query('FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.tripKey == @tripKey REMOVE attachment IN tripAttachments', { scopeKey: context.scopeKey, tripKey });
        await executor.query('FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey REMOVE relation IN tripPlaces', { scopeKey: context.scopeKey, tripKey });
        await executor.query('REMOVE @tripKey IN trips', { tripKey });
        return 'deleted' as const;
      });
      if (result === 'favorite') throw new TravelRepositoryError('favorite');
      if (result !== 'deleted') throw new TravelRepositoryError('forbidden');
      return { tripKey };
    },
    async setTripAttachments(context, tripKey, attachments, updatedAt) {
      z.string().datetime().parse(updatedAt);
      const validAttachments = attachments.map((attachment) => tripAttachmentSchema.parse(attachment));
      if (validAttachments.length > 100 || validAttachments.some((attachment, position) => attachment.scopeKey !== context.scopeKey || attachment.tripKey !== tripKey || attachment.position !== position)) throw new TravelRepositoryError('forbidden');
      const references = validAttachments.map(({ targetType, targetKey }) => `${targetType}\0${targetKey}`);
      if (new Set(references).size !== references.length) throw new TravelRepositoryError('forbidden');
      const updated = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers', 'trips', 'folders', 'collections', 'images', 'collectionImages', 'collectionMembers', 'tripPlaces', 'places', 'placeHeroMedia'],
        write: ['tripAttachments', 'trips'],
      }, async (executor) => {
        const cursor = await executor.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations
          FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
          LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
          FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
          LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
        LET trip = DOCUMENT(trips, @tripKey)
        FILTER trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey
        LET existingAttachments = (FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.tripKey == @tripKey SORT attachment.position ASC, attachment._key ASC RETURN attachment)
        LET validatedTargets = (FOR attachment IN @attachments
          LET folder = attachment.targetType == "folder" ? DOCUMENT(folders, attachment.targetKey) : null
          LET collection = attachment.targetType == "collection" ? DOCUMENT(collections, attachment.targetKey) : null
          LET collectionAccess = collection == null ? false : elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0
          FILTER (attachment.targetType == "folder" && folder != null && folder.scopeKey == @scopeKey && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null))
            || (attachment.targetType == "collection" && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && collection.purpose == null && collectionAccess)
          RETURN attachment)
        FILTER LENGTH(validatedTargets) == LENGTH(@attachments)
        LET unchanged = (FOR attachment IN existingAttachments RETURN { type: attachment.targetType, key: attachment.targetKey }) == (FOR attachment IN @attachments RETURN { type: attachment.targetType, key: attachment.targetKey })
        LET places = (FOR relation IN tripPlaces
          FILTER relation.scopeKey == @scopeKey && relation.tripKey == trip._key
          SORT relation.position ASC, relation._key ASC
          LET place = DOCUMENT(places, relation.placeKey)
          FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
          LET heroStorageKey = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey)
          RETURN { place, heroStorageKey })
        LET customCover = trip.coverImageKey == null ? null : DOCUMENT(images, trip.coverImageKey)
        LET customCoverCollections = customCover == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == customCover._key LET containing = DOCUMENT(collections, relation.collectionKey) FILTER containing != null && containing.scopeKey == @scopeKey RETURN containing._key)
        LET customCoverAccessible = customCover != null && customCover.scopeKey == @scopeKey && (membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"] || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN customCoverCollections && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 || (LENGTH(customCoverCollections) == 0 && customCover.createdByKey == membership._key))
        RETURN { trip, places, attachments: unchanged ? existingAttachments : @attachments, unchanged, accessibleCoverImageKey: customCoverAccessible ? customCover._key : null, coverStorageKey: customCoverAccessible ? customCover.storageKey : FIRST(places).heroStorageKey }
        `, { ...context, tripKey, attachments: validAttachments.map((attachment) => toArangoDoc(attachment)) });
        const presentation = (await cursor.all())[0];
        if (!presentation) throw new TravelRepositoryError('forbidden');
        if ((presentation as { unchanged?: boolean }).unchanged) return presentation;
        await executor.query('FOR existing IN tripAttachments FILTER existing.scopeKey == @scopeKey && existing.tripKey == @tripKey REMOVE existing IN tripAttachments', { scopeKey: context.scopeKey, tripKey });
        if (validAttachments.length > 0) await executor.query('FOR attachment IN @attachments INSERT attachment IN tripAttachments', { attachments: validAttachments.map((attachment) => toArangoDoc(attachment)) });
        await executor.query('UPDATE @tripKey WITH { updatedAt: @updatedAt } IN trips', { tripKey, updatedAt });
        const row = z.object({ trip: z.record(z.unknown()) }).passthrough().parse(presentation);
        return { ...row, trip: { ...row.trip, updatedAt } };
      });
      if (!updated) throw new TravelRepositoryError('forbidden');
      return parseTripPresentation(updated);
    },
    async listTrips(context) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations
          FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
          LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
          FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
          LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
        LET elevated = membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
        FOR trip IN trips
          FILTER trip.scopeKey == @scopeKey && trip.userKey == @userKey
          SORT trip.createdAt ASC, trip._key ASC
          LET places = (FOR relation IN tripPlaces
            FILTER relation.scopeKey == @scopeKey && relation.tripKey == trip._key
            SORT relation.position ASC, relation._key ASC
            LET place = DOCUMENT(places, relation.placeKey)
            FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
            LET heroStorageKey = FIRST(FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && media.userKey == @userKey && media.placeKey == place._key LIMIT 1 RETURN media.storageKey)
            RETURN { place, heroStorageKey })
          LET customCover = trip.coverImageKey == null ? null : DOCUMENT(images, trip.coverImageKey)
          LET customCoverCollections = customCover == null ? [] : (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == customCover._key LET containing = DOCUMENT(collections, relation.collectionKey) FILTER containing != null && containing.scopeKey == @scopeKey RETURN containing._key)
          LET customCoverAccessible = customCover != null && customCover.scopeKey == @scopeKey && (elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN customCoverCollections && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0 || (LENGTH(customCoverCollections) == 0 && customCover.createdByKey == membership._key))
          LET attachments = (FOR attachment IN tripAttachments
            FILTER attachment.scopeKey == @scopeKey && attachment.tripKey == trip._key
            SORT attachment.position ASC, attachment._key ASC
            LET folder = attachment.targetType == "folder" ? DOCUMENT(folders, attachment.targetKey) : null
            LET collection = attachment.targetType == "collection" ? DOCUMENT(collections, attachment.targetKey) : null
            LET collectionAccess = collection == null ? false : elevated || LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.memberKey == membership._key LIMIT 1 RETURN 1) > 0
            FILTER (attachment.targetType == "folder" && folder != null && folder.scopeKey == @scopeKey && (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null))
              || (attachment.targetType == "collection" && collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy != "system-only" && collection.purpose == null && collectionAccess)
            RETURN attachment)
          RETURN { trip, places, attachments, accessibleCoverImageKey: customCoverAccessible ? customCover._key : null, coverStorageKey: customCoverAccessible ? customCover.storageKey : FIRST(places).heroStorageKey }
      `, { ...context });
      return (await cursor.all()).map(parseTripPresentation);
    },
    async searchTrips(context, embedding, dateRange = {}) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
        FOR trip IN trips
          FILTER trip.scopeKey == @scopeKey && trip.userKey == @userKey
          FILTER @createdFrom == null || trip.createdAt >= @createdFrom
          FILTER @createdTo == null || trip.createdAt <= @createdTo
          FILTER IS_ARRAY(trip.embedding) && LENGTH(trip.embedding) == @dimensions && LENGTH(trip.embedding[* FILTER !IS_NUMBER(CURRENT)]) == 0
          LET score = COSINE_SIMILARITY(trip.embedding, @embedding)
          SORT score DESC, trip._key ASC
          RETURN trip._key
      `, { ...context, embedding, dimensions: embedding.length, createdFrom: dateRange.createdFrom ?? null, createdTo: dateRange.createdTo ?? null });
      const rankedKeys = (await cursor.all()).map(String);
      if (rankedKeys.length === 0) return [];
      const byKey = new Map((await repository.listTrips(context)).map((record) => [record.trip.key, record]));
      return rankedKeys.flatMap((tripKey) => { const record = byKey.get(tripKey); return record ? [record] : []; });
    },
    async prepareTripGuide(context, guideKey, tripKey, requestHash) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        LET existing = DOCUMENT(tripGuides, @guideKey)
        LET trip = DOCUMENT(trips, @tripKey)
        FILTER existing != null || (trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey)
        LET places = existing == null ? (FOR relation IN tripPlaces
          FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey
          SORT relation.position ASC, relation._key ASC
          LET place = DOCUMENT(places, relation.placeKey)
          FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
          RETURN place) : []
        RETURN { existing, trip, places }
      `, { ...context, guideKey, tripKey });
      const raw = (await cursor.all())[0] as { existing?: Record<string, unknown> | null; trip?: Record<string, unknown> | null; places?: Record<string, unknown>[] } | undefined;
      if (!raw) throw new TravelRepositoryError('forbidden');
      if (raw.existing) {
        const existing = tripGuideSchema.parse(withArangoKey(raw.existing));
        if (existing.scopeKey !== context.scopeKey || existing.userKey !== context.userKey || existing.tripKey !== tripKey || existing.requestHash !== requestHash) throw new TravelRepositoryError('conflict');
        return { existing };
      }
      if (!raw.trip) throw new TravelRepositoryError('forbidden');
      return { source: { trip: tripSchema.parse(withArangoKey(raw.trip)), places: (raw.places ?? []).map((place) => placeSchema.parse(withArangoKey(place))) } };
    },
    async preparePlaceReference(context, referenceKey, placeKey, kind, requestHash) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
        LET place = DOCUMENT(places, @placeKey)
        FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
        LET existing = DOCUMENT(placeReferences, @referenceKey)
        RETURN { existing, place }
      `, { ...context, referenceKey, placeKey });
      const raw = (await cursor.all())[0] as { existing?: Record<string, unknown> | null; place?: Record<string, unknown> | null } | undefined;
      if (!raw?.place) throw new TravelRepositoryError('forbidden');
      if (raw.existing) {
        const existing = placeReferenceSchema.parse(withArangoKey(raw.existing));
        if (existing.scopeKey !== context.scopeKey || existing.userKey !== context.userKey || existing.placeKey !== placeKey || existing.kind !== kind || existing.requestHash !== requestHash) throw new TravelRepositoryError('conflict');
        return { existing };
      }
      return { place: placeSchema.parse(withArangoKey(raw.place)) };
    },
    async persistGeneratedContent(context, record) {
      const valid = 'tripKey' in record ? tripGuideSchema.parse(record) : placeReferenceSchema.parse(record);
      if (valid.scopeKey !== context.scopeKey || valid.userKey !== context.userKey) throw new TravelRepositoryError('forbidden');
      const isGuide = 'tripKey' in valid;
      const result = await transaction({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'trips', 'places'], write: [isGuide ? 'tripGuides' : 'placeReferences'] }, async (executor) => {
        const cursor = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          LET subject = @isGuide ? DOCUMENT(trips, @subjectKey) : DOCUMENT(places, @subjectKey)
          FILTER subject != null && subject.scopeKey == @scopeKey && subject.userKey == @userKey
          FILTER @isGuide || subject.saved == true
          UPSERT { _key: @key } INSERT @record UPDATE {} IN @@collection
          RETURN NEW
        `, { ...context, isGuide, subjectKey: isGuide ? valid.tripKey : valid.placeKey, key: valid.key, record: toArangoDoc(valid), '@collection': isGuide ? 'tripGuides' : 'placeReferences' });
        return (await cursor.all())[0];
      });
      if (!result) throw new TravelRepositoryError('forbidden');
      const saved = isGuide ? tripGuideSchema.parse(withArangoKey(result as Record<string, unknown>)) : placeReferenceSchema.parse(withArangoKey(result as Record<string, unknown>));
      if (saved.requestHash !== valid.requestHash) throw new TravelRepositoryError('conflict');
      return saved;
    },
    async listTripGuides(context, tripKey) {
      const cursor = await database.query(`
        LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
        LET scope = DOCUMENT(scopes, @scopeKey)
        LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
        FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
        FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member", "viewer"]
        LET trip = DOCUMENT(trips, @tripKey)
        FILTER trip != null && trip.scopeKey == @scopeKey && trip.userKey == @userKey
        FOR guide IN tripGuides
          FILTER guide.scopeKey == @scopeKey && guide.userKey == @userKey && guide.tripKey == @tripKey
          SORT guide.createdAt DESC, guide._key DESC
          LIMIT 100
          RETURN guide
      `, { ...context, tripKey });
      return (await cursor.all()).map((value) => tripGuideSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async listPlaceReferences(context, placeKey, kind) {
      const cursor = await database.query(`${readAuthorizationQuery}
        LET place = DOCUMENT(places, @placeKey)
        FILTER place != null && place.scopeKey == @scopeKey && place.userKey == @userKey && place.saved == true
        FOR reference IN placeReferences
          FILTER reference.scopeKey == @scopeKey && reference.userKey == @userKey && reference.placeKey == @placeKey && reference.kind == @kind
          SORT reference.createdAt DESC, reference._key DESC LIMIT 100 RETURN reference
      `, { ...context, placeKey, kind });
      return (await cursor.all()).map((value) => placeReferenceSchema.parse(withArangoKey(value as Record<string, unknown>)));
    },
    async copyGeneratedDocument(context, record) {
      const valid = { document: documentSchema.parse(record.document), binding: generatedDocumentBindingSchema.parse(record.binding) };
      const expectedFolderKey = generatedDocumentFolderKeys(context.scopeKey)[valid.binding.kind as keyof ReturnType<typeof generatedDocumentFolderKeys>];
      if (!expectedFolderKey || valid.document.scopeKey !== context.scopeKey || valid.document.folderKey !== expectedFolderKey || valid.binding.scopeKey !== context.scopeKey || valid.binding.createdByKey !== context.userKey || valid.binding.documentKey !== valid.document.key) throw new TravelRepositoryError('forbidden');
      await transaction({ read: [], write: ['folders', 'documents', 'generatedDocumentBindings'] }, async (executor) => {
        await ensureGeneratedDocumentFolders(executor, context.scopeKey, valid.document.createdAt);
        await executor.query('UPSERT { _key: @key } INSERT @document UPDATE {} IN documents', { key: valid.document.key, document: toArangoDoc(valid.document) });
        await executor.query('UPSERT { _key: @key } INSERT @binding UPDATE {} IN generatedDocumentBindings', { key: valid.binding.key, binding: toArangoDoc(valid.binding) });
      });
    },
    async ensureGalleryExportCollection(context, collection) {
      const valid = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), ownerKey: z.string().cuid(), memberKey: z.string().cuid(), name: z.string().trim().min(1), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict().parse(collection);
      if (valid.scopeKey !== context.scopeKey) throw new TravelRepositoryError('forbidden');
      await transaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['collections', 'collectionMembers'] }, async (executor) => {
        const cursor = await executor.query(`${writeAuthorizationFilter}
          UPSERT { _key: @collectionKey }
            INSERT { _key: @collectionKey, scopeKey: @scopeKey, name: @name, presentation: "travel", embedding: @embedding, isFavorite: false, createdAt: @createdAt, updatedAt: @updatedAt }
            UPDATE { presentation: "travel" } IN collections
          RETURN membership._key
        `, { ...context, collectionKey: valid.key, name: valid.name, embedding: valid.embedding, createdAt: valid.createdAt, updatedAt: valid.updatedAt });
        if ((await cursor.all())[0] !== valid.ownerKey) throw new TravelRepositoryError('forbidden');
        await executor.query('UPSERT { _key: @memberKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @ownerKey, role: "owner", createdAt: @createdAt } UPDATE {} IN collectionMembers', { memberKey: valid.memberKey, scopeKey: context.scopeKey, collectionKey: valid.key, ownerKey: valid.ownerKey, createdAt: valid.createdAt });
      });
    },
    async linkGalleryExport(context, relation) {
      const valid = collectionImageSchema.parse(relation);
      if (valid.scopeKey !== context.scopeKey) throw new TravelRepositoryError('forbidden');
      await transaction({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'collections', 'images'], write: ['collectionImages'] }, async (executor) => {
        const cursor = await executor.query(`${writeAuthorizationFilter}
          LET collection = DOCUMENT(collections, @collectionKey)
          LET image = DOCUMENT(images, @imageKey)
          FILTER collection != null && collection.scopeKey == @scopeKey
          FILTER image != null && image.scopeKey == @scopeKey && image.createdByKey == @addedByKey
          UPSERT { _key: @relationKey } INSERT @relation UPDATE {} IN collectionImages
          RETURN true
        `, { ...context, collectionKey: valid.collectionKey, imageKey: valid.imageKey, addedByKey: valid.addedByKey, relationKey: valid.key, relation: toArangoDoc(valid) });
        if ((await cursor.all())[0] !== true) throw new TravelRepositoryError('forbidden');
      });
    },
    async convergePlace(input) {
      const place = placeSchema.parse(input.place);
      const hero = placeHeroMediaSchema.parse(input.hero);
      const { context } = input;
      if (place.scopeKey !== context.scopeKey || place.userKey !== context.userKey || hero.scopeKey !== context.scopeKey || hero.userKey !== context.userKey || hero.placeKey !== place.key) throw new TravelRepositoryError('forbidden');
      const saved = await transaction({
        read: ['userOrganizations', 'scopes', 'scopeMembers'],
        write: ['places', 'placeHeroMedia'],
      }, async (executor) => {
        const authorization = await executor.query(`
          LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeRole = membership == null ? null : FIRST(FOR candidate IN scopeMembers FILTER candidate.scopeKey == @scopeKey && candidate.userOrganizationKey == membership._key && candidate.status == "active" LIMIT 1 RETURN candidate.role)
          FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
          FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator", "member"]
          RETURN true
        `, { ...context });
        if ((await authorization.all())[0] !== true) return null;
        const placeCursor = await executor.query('UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name } INSERT @place UPDATE { saved: true, kind: @kind, summary: @summary, latitude: @latitude, longitude: @longitude, embedding: @embedding } IN places RETURN NEW', { scopeKey: context.scopeKey, userKey: context.userKey, countryCode: place.countryCode, name: place.name, kind: place.kind, summary: place.summary, latitude: place.latitude, longitude: place.longitude, embedding: place.embedding, place: toArangoDoc(place) });
        const savedPlace = (await placeCursor.all())[0] as Record<string, unknown> | undefined;
        if (!savedPlace) return null;
        const savedPlaceKey = z.object({ _key: z.string() }).parse(savedPlace)._key;
        const heroCursor = await executor.query('UPSERT { scopeKey: @scopeKey, userKey: @userKey, placeKey: @placeKey } INSERT MERGE(@hero, { placeKey: @placeKey }) UPDATE { storageKey: @storageKey, contentHash: @contentHash, sizeBytes: @sizeBytes, updatedAt: @updatedAt } IN placeHeroMedia RETURN NEW', { scopeKey: context.scopeKey, userKey: context.userKey, placeKey: savedPlaceKey, hero: toArangoDoc(hero), storageKey: hero.storageKey, contentHash: hero.contentHash, sizeBytes: hero.sizeBytes, updatedAt: hero.updatedAt });
        return { place: savedPlace, hero: (await heroCursor.all())[0] };
      });
      if (!saved) throw new TravelRepositoryError('forbidden');
      const row = saved as { place: Record<string, unknown>; hero: Record<string, unknown> };
      const savedHero = placeHeroMediaSchema.parse(withArangoKey(row.hero));
      return { place: placeSchema.parse(withArangoKey(row.place)), heroStorageKey: savedHero.storageKey };
    },
  };
  return repository;
}
