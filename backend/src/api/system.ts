import type { Context } from 'hono';
import { z } from 'zod';
import { getUserById } from '@/lib/db/users.node';
import { listActiveUserOrganizationsByUser } from '@/lib/db/user-organization.node';
import { getOrganizationById } from '@/lib/db/organizations.node';
import {
  getOrchestratorById,
  insertOrchestrator,
  listOrchestratorsPage,
  updateOrchestrator,
} from '@/lib/db/orchestrators.node';
import { getVoiceById } from '@/lib/db/voices.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { getAuthIdentity } from './security';
import { parseJson, parseQuery, strictObject } from './validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const pageQuerySchema = strictObject({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  after: z.string().optional(),
});

const nameSchema = z.string().trim().min(1).max(200);
const roleSchema = z.string().trim().min(1).max(2000);
const voiceIdSchema = z.string().trim().min(1).max(200);
const skillSchema = z.string().trim().min(1);

const orchestratorBodySchema = strictObject({
  key: z.string().trim().min(1).max(200).optional(),
  name: nameSchema,
  role: roleSchema,
  voice_id: voiceIdSchema,
  skill: skillSchema,
});

const orchestratorPatchSchema = strictObject({
  name: nameSchema.optional(),
  role: roleSchema.optional(),
  voice_id: voiceIdSchema.optional(),
  skill: skillSchema.optional(),
});

function nowIso() {
  return new Date().toISOString();
}

async function requireSuperAdmin(c: Context) {
  const auth = await getAuthIdentity(c);
  if (!auth) {
    return { error: c.json({ error: 'authentication required' }, 401) };
  }
  const user = await getUserById(auth.key);
  const memberships = user ? await listActiveUserOrganizationsByUser(user.key) : [];
  const rootMembership = memberships.find((membership) => membership.key === auth.founderMembershipKey);
  const rootOrganization = rootMembership ? await getOrganizationById(rootMembership.organizationId) : null;
  if (
    auth.identityType !== 'superAdmin'
    || auth.founderAssured !== true
    || !rootMembership
    || !rootOrganization?.is_root
    || !rootOrganization.isActive
    || rootMembership.orgRole !== 'owner'
    || !rootMembership.isMfaEnabled
    || rootMembership.mfaVersion !== auth.founderMfaVersion
  ) {
    return { error: c.json({ error: 'super admin required' }, 403) };
  }
  return { key: auth.key, user };
}

function uniqueConflict(c: Context, err: unknown, message: string) {
  if (isArangoUniqueConstraintError(err)) {
    return c.json({ error: message }, 409);
  }
  throw err;
}

function requiredParam(c: Context, name: string) {
  const value = c.req.param(name);
  if (!value) {
    return { error: c.json({ error: `${name} is required` }, 400) };
  }
  return { value };
}

function orchestratorResponse(orchestrator: Awaited<ReturnType<typeof getOrchestratorById>> extends infer T ? NonNullable<T> : never) {
  return {
    id: orchestrator.key,
    name: orchestrator.name,
    role: orchestrator.role,
    voice_id: orchestrator.voiceId,
    skill: orchestrator.skill,
    created_at: orchestrator.createdAt,
    updated_at: orchestrator.updatedAt,
  };
}

export async function listSystemOrchestrators(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const query = parseQuery(c, pageQuerySchema);
  const { items, nextCursor } = await listOrchestratorsPage(query.after, query.limit);
  return c.json({
    items: items.map(orchestratorResponse),
    next_cursor: nextCursor,
  });
}

export async function createSystemOrchestrator(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const body = await parseJson(c, orchestratorBodySchema);
  const voice = await getVoiceById(body.voice_id);
  if (!voice) return c.json({ error: 'voice not found' }, 404);

  const timestamp = nowIso();
  try {
    const orchestrator = await insertOrchestrator({
      key: body.key ?? newId(),
      name: body.name,
      role: body.role,
      voiceId: voice.key,
      skill: body.skill,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json(orchestratorResponse(orchestrator), 201);
  } catch (err) {
    return uniqueConflict(c, err, 'orchestrator key already exists');
  }
}

export async function updateSystemOrchestrator(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const orchestratorParam = requiredParam(c, 'orchestratorId');
  if ('error' in orchestratorParam) return orchestratorParam.error;

  const orchestrator = await getOrchestratorById(orchestratorParam.value);
  if (!orchestrator) return c.json({ error: 'orchestrator not found' }, 404);

  const body = await parseJson(c, orchestratorPatchSchema);
  let voiceId: string | undefined;
  if (body.voice_id !== undefined) {
    const voice = await getVoiceById(body.voice_id);
    if (!voice) return c.json({ error: 'voice not found' }, 404);
    voiceId = voice.key;
  }

  const updated = await updateOrchestrator(orchestrator.key, {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.role === undefined ? {} : { role: body.role }),
    ...(voiceId === undefined ? {} : { voiceId }),
    ...(body.skill === undefined ? {} : { skill: body.skill }),
    updatedAt: nowIso(),
  });
  return c.json(orchestratorResponse(updated));
}
