import { aql } from 'arangojs';
import { db, closeDb } from '@/lib/db/client';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { placeSchema } from '@/lib/db/places.node';
import { placeVisitSchema } from '@/lib/db/place-visits.node';
import { tripSchema } from '@/lib/db/trips.node';
import { createTravelRepository } from '@/lib/travel/repository';

const userKey = newId();
const organizationKey = newId();
const membershipKey = newId();
const scopeKey = newId();
const scopeMembershipKey = newId();
const placeKey = newId();
const tripKey = newId();
const relationKey = newId();
const visitKey = newId();
const now = new Date().toISOString();
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
const context = { organizationKey, scopeKey, userKey };

async function cleanup() {
  await db.query(aql`FOR item IN placeVisits FILTER item.scopeKey == ${scopeKey} REMOVE item IN placeVisits`);
  await db.query(aql`FOR item IN tripPlaces FILTER item.scopeKey == ${scopeKey} REMOVE item IN tripPlaces`);
  await db.query(aql`FOR item IN places FILTER item.scopeKey == ${scopeKey} REMOVE item IN places`);
  await db.query(aql`FOR item IN trips FILTER item.scopeKey == ${scopeKey} REMOVE item IN trips`);
  await db.query(aql`FOR item IN scopeMembers FILTER item.scopeKey == ${scopeKey} REMOVE item IN scopeMembers`);
  await db.query(aql`REMOVE ${scopeKey} IN scopes OPTIONS { ignoreErrors: true }`);
  await db.query(aql`REMOVE ${membershipKey} IN userOrganizations OPTIONS { ignoreErrors: true }`);
}

try {
  await db.query(aql`INSERT { _key: ${membershipKey}, organizationId: ${organizationKey}, userId: ${userKey}, orgRole: "owner", status: "active" } INTO userOrganizations`);
  await db.query(aql`INSERT { _key: ${scopeKey}, organizationKey: ${organizationKey}, slug: ${`travel-e2e-${scopeKey}`}, name: "Travel E2E" } INTO scopes`);
  await db.query(aql`INSERT { _key: ${scopeMembershipKey}, scopeKey: ${scopeKey}, userOrganizationKey: ${membershipKey}, role: "owner", status: "active" } INTO scopeMembers`);

  const repository = createTravelRepository();
  const place = placeSchema.parse({ key: placeKey, scopeKey, kind: 'country', name: 'Sweden', latitude: 62, longitude: 15, countryCode: 'SE', country: 'Sweden', continent: 'Europe', isWishlist: true, embedding, createdAt: now, updatedAt: now });
  const trip = tripSchema.parse({ key: tripKey, scopeKey, name: 'Nordic loop', embedding, createdAt: now, updatedAt: now });
  await repository.createPlace(context, place);
  await repository.createTrip(context, trip);
  await repository.appendPlace(context, { key: relationKey, scopeKey, tripKey, placeKey, createdAt: now });

  const planned = await repository.overview(context);
  if (planned.trips[0]?.itinerary[0]?.place.key !== placeKey) throw new Error('Itinerary overview did not resolve the persisted place.');

  const visit = placeVisitSchema.parse({ key: visitKey, scopeKey, placeKey, createdAt: now, updatedAt: now });
  const firstVisit = await repository.createVisit(context, visit, now);
  const replayedVisit = await repository.createVisit(context, { ...visit, key: newId() }, now);
  if (firstVisit.visit.key !== replayedVisit.visit.key || replayedVisit.visitCount !== 1) throw new Error('Visit replay was not idempotent.');

  await repository.appendPlace(context, { key: newId(), scopeKey, tripKey, placeKey, createdAt: now });
  await repository.removePlace(context, tripKey, placeKey);
  const removed = await repository.overview(context);
  if (removed.trips[0]?.itinerary.length !== 0 || removed.places[0]?.visitCount !== 1) throw new Error('Removal or visit aggregation did not persist correctly.');

  console.log('Travel persistence E2E passed: create, itinerary overview, idempotent visit, replayed append, and removal.');
} finally {
  await cleanup();
  await closeDb();
}
