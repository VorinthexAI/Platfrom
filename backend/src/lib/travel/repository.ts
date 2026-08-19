import { withArangoKey } from '@/lib/db/base';
import { db } from '@/lib/db/client';
import { placeSchema, type Place } from '@/lib/db/places.node';

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

async function authorizeRead(database: TravelDatabase, context: TravelAccessContext): Promise<void> {
  const rows = await (await database.query(readAuthorizationQuery, { ...context })).all();
  if (rows.length === 0) throw new TravelRepositoryError('forbidden');
}

export class TravelRepositoryError extends Error {
  constructor(readonly reason: 'forbidden') { super(reason); }
}

export interface TravelRepository {
  authorizeRead(context: TravelAccessContext): Promise<void>;
  overview(context: TravelAccessContext): Promise<Place[]>;
}

export function createTravelRepository(database: TravelDatabase = db): TravelRepository {
  return {
    authorizeRead(context) {
      return authorizeRead(database, context);
    },
    async overview(context) {
      await authorizeRead(database, context);
      const cursor = await database.query('FOR place IN places FILTER place.scopeKey == @scopeKey SORT place.name ASC, place._key ASC RETURN place', { scopeKey: context.scopeKey });
      return (await cursor.all()).map((place) => placeSchema.parse(withArangoKey(place as Record<string, unknown>)));
    },
  };
}
