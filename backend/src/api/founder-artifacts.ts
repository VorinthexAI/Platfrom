import type { Context } from 'hono';
import { z } from 'zod';
import { artifactDefinitionSchema, nodeRefSchema, ArtifactAuthorizationError, ArtifactCycleError, ArtifactNotFoundError, getDefaultArtifactService } from '@/lib/artifacts';
import { recordRuntimeEvent } from '@/platform/events';
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

const readNodeSchema = strictObject({ organizationKey: foundersOrganizationKeyParamSchema, scopeKey: z.string().cuid(), ref: nodeRefSchema });

async function authorize(c: Context, organizationKey: string, scopeKey: string) {
  const auth = await requireFounder(c); if ('error' in auth) return auth;
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, organizationKey);
    await requireScopeAccess(membership, scopeKey);
    return { founder: auth.founder, membership };
  } catch (error) { return { error: forbidden(c, error) }; }
}

function resolveContext(organizationKey: string, scopeKey: string, membership: { orgRole: string }) {
  return {
    organizationKey,
    scopeKey,
    organizationWide: membership.orgRole === 'owner' || membership.orgRole === 'admin',
    allowedScopeKeys: [scopeKey],
  };
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
    const artifact = await getDefaultArtifactService().create({ ...body, ...resolveContext(body.organizationKey, body.scopeKey, auth.membership), createdByUserOrganizationKey: auth.membership.key });
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.created', data: { nodeType: 'artifacts', nodeKey: artifact.key } });
    return c.json({ artifact }, 201);
  } catch (error) { return serviceError(c, error); }
}

export async function getFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  try { return c.json({ artifact: await getDefaultArtifactService().get(key, resolveContext(query.organizationKey, query.scopeKey, auth.membership)) }); } catch (error) { return serviceError(c, error); }
}

export async function updateFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const body = await parseJson(c, updateSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const artifact = await getDefaultArtifactService().update(key, body, resolveContext(body.organizationKey, body.scopeKey, auth.membership));
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.updated', data: { nodeType: 'artifacts', nodeKey: key } });
    return c.json({ artifact });
  } catch (error) { return serviceError(c, error); }
}

export async function deleteFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const query = parseQuery(c, contextSchema); const auth = await authorize(c, query.organizationKey, query.scopeKey); if ('error' in auth) return auth.error;
  try {
    await getDefaultArtifactService().remove(key, resolveContext(query.organizationKey, query.scopeKey, auth.membership));
    await recordRuntimeEvent({ scopeId: query.scopeKey, userId: auth.founder.user.key, slug: 'artifact.deleted', data: { nodeType: 'artifacts', nodeKey: key } });
    return c.body(null, 204);
  } catch (error) { return serviceError(c, error); }
}

export async function resolveFounderArtifact(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const body = await parseJson(c, contextSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const resolved = await getDefaultArtifactService().resolve(key, resolveContext(body.organizationKey, body.scopeKey, auth.membership));
    await recordRuntimeEvent({ scopeId: body.scopeKey, userId: auth.founder.user.key, slug: 'artifact.resolved', data: { nodeType: 'artifacts', nodeKey: key } });
    return c.json(resolved);
  } catch (error) { return serviceError(c, error); }
}

export async function readFounderArtifactNode(c: Context) {
  const key = artifactKeySchema.parse(c.req.param('artifactKey')); const body = await parseJson(c, readNodeSchema); const auth = await authorize(c, body.organizationKey, body.scopeKey); if ('error' in auth) return auth.error;
  try {
    const result = await getDefaultArtifactService().readNode(key, body.ref, resolveContext(body.organizationKey, body.scopeKey, auth.membership));
    return c.json({ ref: { nodeType: body.ref.type, nodeKey: body.ref.key }, details: result.value, revision: result.revision });
  } catch (error) { return serviceError(c, error); }
}
