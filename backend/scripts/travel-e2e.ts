import { aql } from 'arangojs';
import { closeDb, db } from '@/lib/db/client';
import { placeSchema, upsertPlaceByKey } from '@/lib/db/places.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createTravelRepository } from '@/lib/travel/repository';

const userKey = newId();
const organizationKey = newId();
const membershipKey = newId();
const scopeKey = newId();
const scopeMembershipKey = newId();
const placeKey = newId();
const now = new Date().toISOString();
const context = { organizationKey, scopeKey, userKey };

async function cleanup() {
  await db.query(aql`FOR item IN places FILTER item.scopeKey == ${scopeKey} REMOVE item IN places`);
  await db.query(aql`FOR item IN scopeMembers FILTER item.scopeKey == ${scopeKey} REMOVE item IN scopeMembers`);
  await db.query(aql`REMOVE ${scopeKey} IN scopes OPTIONS { ignoreErrors: true }`);
  await db.query(aql`REMOVE ${membershipKey} IN userOrganizations OPTIONS { ignoreErrors: true }`);
}

try {
  await db.query(aql`INSERT { _key: ${membershipKey}, organizationId: ${organizationKey}, userId: ${userKey}, orgRole: "owner", status: "active" } INTO userOrganizations`);
  await db.query(aql`INSERT { _key: ${scopeKey}, organizationKey: ${organizationKey}, slug: ${`travel-e2e-${scopeKey}`}, name: "Travel E2E" } INTO scopes`);
  await db.query(aql`INSERT { _key: ${scopeMembershipKey}, scopeKey: ${scopeKey}, userOrganizationKey: ${membershipKey}, role: "owner", status: "active" } INTO scopeMembers`);

  const repository = createTravelRepository();
  const place = placeSchema.parse({ key: placeKey, userKey, scopeKey, saved: true, name: 'Stockholm', summary: '', countryCode: 'SE', latitude: 59.3293, longitude: 18.0686, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), embeddingContentVersion: 2, createdAt: now });
  await upsertPlaceByKey(place);
  const overview = await repository.overview(context);
  if (overview.places.length !== 1 || overview.places[0]?.key !== placeKey) throw new Error('Saved city was not returned by the overview.');

  console.log('Travel persistence E2E passed: administratively seeded city is listed.');
} finally {
  await cleanup();
  await closeDb();
}
