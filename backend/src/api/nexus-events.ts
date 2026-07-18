import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { artifactQueryIdsInvalidatedBy } from '@/lib/artifacts';
import { withArangoKey } from '@/lib/db/base';
import { db } from '@/lib/db/client';
import { eventSchema } from '@/lib/db/events.node';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import { listAccessibleScopes, requireFoundersGateAccess, requireOrganizationAccess } from '@/lib/founders/access';
import { getDefaultScopeRepository } from '@/lib/ai/scopes';
import { artifactInvalidation, organizationInvalidationSlugs, projectOrganizationInvalidation, type PersistedOrganizationEvent } from '@/lib/live/organization-invalidation';
import { parseQuery, strictObject } from './validation';
import { forbidden, foundersOrganizationKeyParamSchema, requireFounder } from './founders';

const organizationStreamQuerySchema = strictObject({ organizationKey: foundersOrganizationKeyParamSchema });
const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const ACCESS_RECHECK_INTERVAL_MS = 15_000;
const EVENT_BATCH_SIZE = 100;

type StoredEvent = PersistedOrganizationEvent & { key: string; createdAt: string };

async function accessibleScopeKeys(membership: UserOrganization) {
  if (membership.orgRole === 'owner' || membership.orgRole === 'admin') {
    return (await getDefaultScopeRepository().listScopes(membership.organizationId)).map(({ key }) => key);
  }
  return (await listAccessibleScopes(membership)).map(({ key }) => key);
}

async function affectedArtifacts(organizationKey: string, event: StoredEvent): Promise<string[]> {
  const queryIds = artifactQueryIdsInvalidatedBy(event.slug);
  const nodeType = typeof event.data?.nodeType === 'string' ? event.data.nodeType : null;
  const nodeKey = typeof event.data?.nodeKey === 'string' ? event.data.nodeKey : null;
  if (queryIds.length === 0 && (!nodeType || !nodeKey)) return [];

  const cursor = await db.query(`
    FOR dependency IN artifactDependencies
      FILTER dependency.organizationKey == @organizationKey
        AND dependency.scopeKey == @scopeKey
        AND (
          (dependency.dependencyType == "query" AND dependency.queryId IN @queryIds)
          OR (dependency.dependencyType == "node" AND dependency.nodeType == @nodeType AND dependency.nodeKey == @nodeKey)
          OR (dependency.dependencyType == "artifact" AND @nodeType == "artifacts" AND dependency.referencedArtifactKey == @nodeKey)
        )
      RETURN DISTINCT dependency.artifactKey
  `, { organizationKey, scopeKey: event.scopeId, queryIds, nodeType, nodeKey });
  return await cursor.all() as string[];
}

/**
 * One organization-wide SSE invalidation channel for runtime, tool, domain,
 * and artifact lifecycle events. It reads the durable event log so updates
 * survive multiple API instances. Only slug + scope/resource identity leave
 * the backend; clients fetch authorized data through normal endpoints.
 */
export async function streamNexusOrganizationInvalidations(c: Context) {
  const query = parseQuery(c, organizationStreamQuerySchema);
  const connectedAt = new Date().toISOString();
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;

  let membership;
  try {
    ({ membership } = await requireOrganizationAccess(auth.founder.user.key, query.organizationKey));
  } catch (error) {
    return forbidden(c, error);
  }
  let scopeKeys = await accessibleScopeKeys(membership);

  return streamSSE(c, async (stream) => {
    let lastCreatedAt = connectedAt;
    let lastKey = '';
    let lastHeartbeatAt = Date.now();
    let lastAccessCheckAt = Date.now();

    while (!stream.aborted) {
      const loopStartedAt = Date.now();
      if (loopStartedAt - lastAccessCheckAt >= ACCESS_RECHECK_INTERVAL_MS) {
        try {
          await requireFoundersGateAccess(auth.founder.user.key);
          const refreshed = await requireOrganizationAccess(auth.founder.user.key, query.organizationKey);
          scopeKeys = await accessibleScopeKeys(refreshed.membership);
          lastAccessCheckAt = loopStartedAt;
        } catch {
          break;
        }
      }
      const cursor = await db.query(`
        FOR event IN events
          FILTER event.scopeId IN @scopeKeys
            AND event.slug IN @eventSlugs
            AND (event.createdAt > @lastCreatedAt OR (event.createdAt == @lastCreatedAt AND event._key > @lastKey))
          SORT event.createdAt ASC, event._key ASC
          LIMIT @limit
          RETURN event
      `, { scopeKeys, eventSlugs: organizationInvalidationSlugs, lastCreatedAt, lastKey, limit: EVENT_BATCH_SIZE });
      const events = (await cursor.all() as Record<string, unknown>[])
        .map((event) => eventSchema.parse(withArangoKey(event)) as StoredEvent);

      const derivedArtifacts = new Map<string, string>();
      for (const event of events) {
        lastCreatedAt = event.createdAt;
        lastKey = event.key;
        await stream.writeSSE({ event: 'invalidate', data: JSON.stringify(projectOrganizationInvalidation(event)) });
        for (const artifactKey of await affectedArtifacts(query.organizationKey, event)) {
          if (!(event.data?.nodeType === 'artifacts' && event.data.nodeKey === artifactKey)) {
            derivedArtifacts.set(artifactKey, event.scopeId);
          }
        }
      }
      for (const [artifactKey, scopeKey] of derivedArtifacts) {
        await stream.writeSSE({ event: 'invalidate', data: JSON.stringify(artifactInvalidation(scopeKey, artifactKey)) });
      }

      const now = Date.now();
      if (events.length === 0 && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        await stream.writeSSE({ event: 'heartbeat', data: '{}' });
        lastHeartbeatAt = now;
      }
      if (events.length < EVENT_BATCH_SIZE) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  });
}
