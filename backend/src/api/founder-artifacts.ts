import { EventEmitter } from 'node:events';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { artifactDefinitionSchema, ArtifactAuthorizationError, ArtifactCycleError, ArtifactNotFoundError, artifactQueryIdsInvalidatedBy, getDefaultArtifactService } from '@/lib/artifacts';
import { recordRuntimeEvent } from '@/platform/events';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { requireOrganizationAccess, requireScopeAccess, FoundersAccessError } from '@/lib/founders/access';
import { parseJson, parseQuery, strictObject } from './validation';
import { forbidden, foundersOrganizationKeyParamSchema, requireFounder } from './founders';

const artifactKeySchema = z.string().cuid();
const contextSchema = strictObject({ organizationKey: foundersOrganizationKeyParamSchema, scopeKey: z.string().cuid() });
const createSchema = strictObject({
  organizationKey: foundersOrganizationKeyParamSchema,
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(160),
  definition: artifactDefinitionSchema,
});
const updateSchema = strictObject({
  organizationKey: foundersOrganizationKeyParamSchema,
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(160),
  definition: artifactDefinitionSchema,
});

type ArtifactInvalidation = { organizationKey: string; scopeKey: string; artifactKey: string; reason: 'created' | 'updated' | 'deleted' };
const artifactEvents = new EventEmitter();
artifactEvents.setMaxListeners(500);

async function authorize(c: Context, organizationKey: string, scopeKey: string) {
  const auth = await requireFounder(c); if ('error' in auth) return auth;
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, organizationKey);
    await requireScopeAccess(membership, scopeKey);
    return { founder: auth.founder, membership };
  } catch (error) { return { error: forbidden(c, error) }; }
}

function serviceError(c: Context, error: unknown): Response {
  if (error instanceof ArtifactNotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof ArtifactAuthorizationError || error instanceof FoundersAccessError) return c.json({ error: 'artifact access denied' }, 403);
  if (error instanceof ArtifactCycleError) return c.json({ error: error.message }, 409);
  throw error;
}

export async function listFounderArtifacts(c: Context) {
  const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  return c.json({ artifacts: await getDefaultArtifactService().list(query) });
}

export async function createFounderArtifact(c: Context) {
  const body = await parseJson(c, createSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const artifact = await getDefaultArtifactService().create({ ...body, createdByUserOrganizationKey: auth.membership.key });
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.created', data: { nodeType: 'artifacts', nodeKey: artifact.key } });
    artifactEvents.emit('invalidate', { organizationKey: body.organizationKey, scopeKey: body.scopeKey, artifactKey: artifact.key, reason: 'created' } satisfies ArtifactInvalidation);
    return c.json({ artifact }, 201);
  } catch (error) { return serviceError(c, error); }
}

export async function getFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  try { return c.json({ artifact: await getDefaultArtifactService().get(key, query) }); } catch (error) { return serviceError(c, error); }
}

export async function updateFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const body = await parseJson(c, updateSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const artifact = await getDefaultArtifactService().update(key, body, body);
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.updated', data: { nodeType: 'artifacts', nodeKey: key } });
    artifactEvents.emit('invalidate', { organizationKey: body.organizationKey, scopeKey: body.scopeKey, artifactKey: key, reason: 'updated' } satisfies ArtifactInvalidation);
    return c.json({ artifact });
  } catch (error) { return serviceError(c, error); }
}

export async function deleteFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  try {
    await getDefaultArtifactService().remove(key, query);
    await recordRuntimeEvent({ scopeId: query.scopeKey, userId: auth.founder.user.key, slug: 'artifact.deleted', data: { nodeType: 'artifacts', nodeKey: key } });
    artifactEvents.emit('invalidate', { ...query, artifactKey: key, reason: 'deleted' } satisfies ArtifactInvalidation);
    return c.body(null, 204);
  } catch (error) { return serviceError(c, error); }
}

export async function resolveFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const body = await parseJson(c, contextSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const resolved = await getDefaultArtifactService().resolve(key, body);
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.resolved', data: { nodeType: 'artifacts', nodeKey: key } });
    return c.json(resolved);
  } catch (error) { return serviceError(c, error); }
}

export async function streamFounderArtifactInvalidations(c: Context) {
  const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  return streamSSE(c, async (stream) => {
    const queue: ArtifactInvalidation[] = []; let wake: (() => void) | null = null;
    let lastCreatedAt = new Date().toISOString(); let lastKey = '';
    const listener = (event: ArtifactInvalidation) => { if (event.organizationKey === query.organizationKey && event.scopeKey === query.scopeKey) { queue.push(event); wake?.(); } };
    artifactEvents.on('invalidate', listener);
    try {
      while (!stream.aborted) {
        if (queue.length === 0) await Promise.race([new Promise<void>((resolve) => { wake = resolve; }), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
        wake = null;
        const event = queue.shift();
        if (event) await stream.writeSSE({ event: 'artifact.invalidated', data: JSON.stringify(event) });
        const eventCursor = await db.query(`
          FOR event IN events
            FILTER event.scopeId == @scopeKey
              AND (event.createdAt > @lastCreatedAt OR (event.createdAt == @lastCreatedAt AND event._key > @lastKey))
            SORT event.createdAt ASC, event._key ASC
            LIMIT 100
            RETURN event
        `, { scopeKey: query.scopeKey, lastCreatedAt, lastKey });
        const events = (await eventCursor.all() as Record<string, unknown>[]).map((event) => withArangoKey(event) as { key: string; createdAt: string; slug: string; data?: { nodeType?: string; nodeKey?: string } });
        const affected = new Set<string>();
        for (const persistedEvent of events) {
          lastCreatedAt = persistedEvent.createdAt; lastKey = persistedEvent.key;
          const queryIds = artifactQueryIdsInvalidatedBy(persistedEvent.slug);
          const dependencyCursor = await db.query(`
            FOR dependency IN artifactDependencies
              FILTER dependency.organizationKey == @organizationKey AND dependency.scopeKey == @scopeKey
                AND (
                  (dependency.dependencyType == "query" AND dependency.queryId IN @queryIds)
                  OR (dependency.dependencyType == "node" AND dependency.nodeType == @nodeType AND dependency.nodeKey == @nodeKey)
                  OR (dependency.dependencyType == "artifact" AND @nodeType == "artifacts" AND dependency.referencedArtifactKey == @nodeKey)
                )
              RETURN DISTINCT dependency.artifactKey
          `, { organizationKey: query.organizationKey, scopeKey: query.scopeKey, queryIds, nodeType: persistedEvent.data?.nodeType ?? null, nodeKey: persistedEvent.data?.nodeKey ?? null });
          for (const artifactKey of await dependencyCursor.all() as string[]) affected.add(artifactKey);
        }
        for (const artifactKey of affected) await stream.writeSSE({ event: 'artifact.invalidated', data: JSON.stringify({ ...query, artifactKey, reason: 'updated' }) });
        if (!event && affected.size === 0) await stream.writeSSE({ event: 'heartbeat', data: '{}' });
      }
    } finally { artifactEvents.off('invalidate', listener); }
  });
}
