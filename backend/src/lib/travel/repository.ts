import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { placeSchema, type Place } from '@/lib/db/places.node';
import { tripSchema, type Trip } from '@/lib/db/trips.node';
import { tripPlaceSchema, type TripPlace } from '@/lib/db/trip-places.node';
import { placeVisitSchema, type PlaceVisit } from '@/lib/db/place-visits.node';

export interface TravelAccessContext { organizationKey: string; scopeKey: string; userKey: string }
export interface TravelDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }
type TransactionRunner = <T>(collections: { read?: string[]; write: string[] }, operation: (database: TravelDatabase) => Promise<T>) => Promise<T>;

export interface TravelOverviewRow {
  places: Array<{ place: Place; visitCount: number }>;
  trips: Array<{ trip: Trip; itinerary: Array<{ relation: TripPlace; place: Place; visitCount: number }> }>;
}

export type TravelWriteRole = 'owner' | 'admin' | 'moderator' | 'member' | 'viewer' | null;
export function hasTravelWriteAccess(organizationRole: TravelWriteRole, scopeRole: TravelWriteRole): boolean {
  return organizationRole === 'owner' || organizationRole === 'admin'
    || scopeRole === 'owner' || scopeRole === 'admin' || scopeRole === 'moderator';
}

const authorizationQuery = `
  LET membership = FIRST(FOR candidate IN userOrganizations
    FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active"
    LIMIT 1 RETURN candidate)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
    FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active"
    LIMIT 1 RETURN member.role)
  FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
  FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]
  RETURN membership._key
`;

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

async function authorize(database: TravelDatabase, context: TravelAccessContext): Promise<void> {
  const rows = await (await database.query(authorizationQuery, { ...context })).all();
  if (rows.length === 0) throw new TravelRepositoryError('forbidden');
}

async function authorizeRead(database: TravelDatabase, context: TravelAccessContext): Promise<void> {
  const rows = await (await database.query(readAuthorizationQuery, { ...context })).all();
  if (rows.length === 0) throw new TravelRepositoryError('forbidden');
}

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(withArangoKey(value as Record<string, unknown>));
}

const defaultTransactionRunner: TransactionRunner = (collections, operation) =>
  withTransaction(collections, (transaction) => operation(transaction));

export class TravelRepositoryError extends Error {
  constructor(readonly reason: 'forbidden' | 'not_found' | 'duplicate') { super(reason); }
}

export interface TravelRepository {
  authorizeRead(context: TravelAccessContext): Promise<void>;
  authorizeWrite(context: TravelAccessContext): Promise<void>;
  findCountry(context: TravelAccessContext, countryCode: string): Promise<Place | null>;
  overview(context: TravelAccessContext): Promise<TravelOverviewRow>;
  createPlace(context: TravelAccessContext, place: Place): Promise<Place>;
  createVisit(context: TravelAccessContext, visit: PlaceVisit, now: string): Promise<{ place: Place; visit: PlaceVisit; visitCount: number }>;
  createTrip(context: TravelAccessContext, trip: Trip): Promise<Trip>;
  appendPlace(context: TravelAccessContext, relation: Omit<TripPlace, 'position'>): Promise<{ relation: TripPlace; place: Place }>;
  removePlace(context: TravelAccessContext, tripKey: string, placeKey: string): Promise<void>;
}

export function createTravelRepository(database: TravelDatabase = db, runTransaction: TransactionRunner = defaultTransactionRunner): TravelRepository {
  return {
    authorizeRead(context) {
      return authorizeRead(database, context);
    },
    authorizeWrite(context) {
      return authorize(database, context);
    },
    async findCountry(context, countryCode) {
      await authorizeRead(database, context);
      const cursor = await database.query(`FOR place IN places FILTER place.scopeKey == @scopeKey && place.kind == "country" && place.countryCode == @countryCode LIMIT 1 RETURN place`, { scopeKey: context.scopeKey, countryCode });
      const raw = (await cursor.all())[0];
      return raw ? parse(placeSchema, raw) : null;
    },
    async overview(context) {
      await authorizeRead(database, context);
      const cursor = await database.query(`
        LET placeRows = (FOR place IN places
          FILTER place.scopeKey == @scopeKey
          LET visitCount = LENGTH(FOR visit IN placeVisits FILTER visit.scopeKey == @scopeKey && visit.placeKey == place._key RETURN 1)
          SORT place.name ASC, place._key ASC RETURN { place, visitCount })
        LET trips = (FOR trip IN trips
          FILTER trip.scopeKey == @scopeKey
          LET itinerary = (FOR relation IN tripPlaces
            FILTER relation.scopeKey == @scopeKey && relation.tripKey == trip._key
            LET place = DOCUMENT(places, relation.placeKey)
            FILTER place != null && place.scopeKey == @scopeKey
            LET visitCount = LENGTH(FOR visit IN placeVisits FILTER visit.scopeKey == @scopeKey && visit.placeKey == place._key RETURN 1)
            SORT relation.position ASC, relation._key ASC RETURN { relation, place, visitCount })
          SORT trip.startDate ASC, trip.name ASC, trip._key ASC RETURN { trip, itinerary })
        RETURN { places: placeRows, trips }
      `, { scopeKey: context.scopeKey });
      const raw = (await cursor.all())[0] as { places?: Array<{ place: unknown; visitCount: number }>; trips?: Array<{ trip: unknown; itinerary: Array<{ relation: unknown; place: unknown; visitCount: number }> }> } | undefined;
      return {
        places: (raw?.places ?? []).map((row) => ({ place: parse(placeSchema, row.place), visitCount: Number(row.visitCount) })),
        trips: (raw?.trips ?? []).map((row) => ({ trip: parse(tripSchema, row.trip), itinerary: row.itinerary.map((item) => ({ relation: parse(tripPlaceSchema, item.relation), place: parse(placeSchema, item.place), visitCount: Number(item.visitCount) })) })),
      };
    },
    createPlace(context, place) {
      return runTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['places'] }, async (transaction) => {
        await authorize(transaction, context);
        const cursor = await transaction.query('INSERT @place INTO places RETURN NEW', { place: toArangoDoc(place) });
        return parse(placeSchema, (await cursor.all())[0]);
      });
    },
    createVisit(context, visit, now) {
      return runTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['places', 'trips', 'placeVisits'] }, async (transaction) => {
        await authorize(transaction, context);
        const references = await (await transaction.query(`
          LET place = DOCUMENT(places, @placeKey)
          LET trip = @tripKey == null ? true : DOCUMENT(trips, @tripKey)
          FILTER place != null && place.scopeKey == @scopeKey
          FILTER @tripKey == null || (trip != null && trip.scopeKey == @scopeKey)
          RETURN true
        `, { scopeKey: context.scopeKey, placeKey: visit.placeKey, tripKey: visit.tripKey ?? null })).all();
        if (references.length === 0) throw new TravelRepositoryError('not_found');
        const existingCursor = await transaction.query(`FOR item IN placeVisits FILTER item.scopeKey == @scopeKey && item.placeKey == @placeKey FILTER (@tripKey == null && !HAS(item, "tripKey")) || item.tripKey == @tripKey LIMIT 1 RETURN item`, { scopeKey: context.scopeKey, placeKey: visit.placeKey, tripKey: visit.tripKey ?? null });
        const existingVisit = (await existingCursor.all())[0];
        const savedVisit = existingVisit ?? (await (await transaction.query('INSERT @visit INTO placeVisits RETURN NEW', { visit: toArangoDoc(visit) })).all())[0];
        const placeCursor = await transaction.query('UPDATE @placeKey WITH { isWishlist: false, updatedAt: @now } IN places RETURN NEW', { placeKey: visit.placeKey, now });
        const countCursor = await transaction.query('RETURN LENGTH(FOR item IN placeVisits FILTER item.scopeKey == @scopeKey && item.placeKey == @placeKey RETURN 1)', { scopeKey: context.scopeKey, placeKey: visit.placeKey });
        return { visit: parse(placeVisitSchema, savedVisit), place: parse(placeSchema, (await placeCursor.all())[0]), visitCount: Number((await countCursor.all())[0]) };
      });
    },
    createTrip(context, trip) {
      return runTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['trips'] }, async (transaction) => {
        await authorize(transaction, context);
        const cursor = await transaction.query('INSERT @trip INTO trips RETURN NEW', { trip: toArangoDoc(trip) });
        return parse(tripSchema, (await cursor.all())[0]);
      });
    },
    appendPlace(context, relation) {
      return runTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['places', 'trips', 'tripPlaces'] }, async (transaction) => {
        await authorize(transaction, context);
        const cursor = await transaction.query(`
          LET trip = DOCUMENT(trips, @tripKey)
          LET place = DOCUMENT(places, @placeKey)
          LET existing = FIRST(FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey && relation.placeKey == @placeKey LIMIT 1 RETURN relation)
          FILTER trip != null && trip.scopeKey == @scopeKey && place != null && place.scopeKey == @scopeKey
           RETURN { place, existing, position: MAX(APPEND([0], (FOR item IN tripPlaces FILTER item.scopeKey == @scopeKey && item.tripKey == @tripKey RETURN item.position))) + 1 }
        `, { scopeKey: context.scopeKey, tripKey: relation.tripKey, placeKey: relation.placeKey });
        const row = (await cursor.all())[0] as { place: unknown; existing: unknown | null; position: number } | undefined;
        if (!row) throw new TravelRepositoryError('not_found');
        if (row.existing) return { relation: parse(tripPlaceSchema, row.existing), place: parse(placeSchema, row.place) };
        const value = tripPlaceSchema.parse({ ...relation, position: row.position });
        const inserted = await transaction.query('INSERT @relation INTO tripPlaces RETURN NEW', { relation: toArangoDoc(value) });
        return { relation: parse(tripPlaceSchema, (await inserted.all())[0]), place: parse(placeSchema, row.place) };
      });
    },
    removePlace(context, tripKey, placeKey) {
      return runTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['trips', 'tripPlaces'] }, async (transaction) => {
        await authorize(transaction, context);
        const cursor = await transaction.query(`LET trip = DOCUMENT(trips, @tripKey) FILTER trip != null && trip.scopeKey == @scopeKey FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey && relation.tripKey == @tripKey && relation.placeKey == @placeKey LIMIT 1 RETURN relation`, { scopeKey: context.scopeKey, tripKey, placeKey });
        const rawRelation = (await cursor.all())[0];
        if (!rawRelation) throw new TravelRepositoryError('not_found');
        const relation = parse(tripPlaceSchema, rawRelation);
        await transaction.query('REMOVE @relationKey IN tripPlaces', { relationKey: relation.key });
        const position = relation.position;
        await transaction.query('FOR item IN tripPlaces FILTER item.scopeKey == @scopeKey && item.tripKey == @tripKey && item.position > @position UPDATE item WITH { position: -item.position } IN tripPlaces', { scopeKey: context.scopeKey, tripKey, position });
        await transaction.query('FOR item IN tripPlaces FILTER item.scopeKey == @scopeKey && item.tripKey == @tripKey && item.position < 0 UPDATE item WITH { position: -item.position - 1 } IN tripPlaces', { scopeKey: context.scopeKey, tripKey });
      });
    },
  };
}
