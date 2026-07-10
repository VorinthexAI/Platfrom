import type { Context } from 'hono';
import { z } from 'zod';
import {
  getAgentById,
  insertAgent,
  listAgentsByOrchestratorId,
  listAgentsPage,
  updateAgent,
} from '@/lib/db/agents.node';
import {
  getCapabilityById,
  insertCapability,
  listCapabilitiesPage,
  updateCapability,
} from '@/lib/db/capabilities.node';
import { getUserById } from '@/lib/db/users.node';
import {
  deleteMindCapability,
  getMindCapabilityByPair,
  insertMindCapability,
  listMindCapabilitiesByMindId,
} from '@/lib/db/mind-capabilities.node';
import { getMindByUserId, insertMind, updateMind } from '@/lib/db/minds.node';
import {
  getOrchestratorById,
  insertOrchestrator,
  listOrchestratorsPage,
  updateOrchestrator,
} from '@/lib/db/orchestrators.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { getAuthIdentity, getUserId } from './security';
import { parseJson, parseQuery, strictObject } from './validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const pageQuerySchema = strictObject({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  after: z.string().optional(),
});

const storagePathSchema = z.string().trim().min(1).max(500);
const nameSchema = z.string().trim().min(1).max(200);
const modelSchema = z.string().trim().min(1).max(200);
const roleSchema = z.string().trim().min(1).max(2000);

const mindBodySchema = strictObject({
  name: nameSchema.optional(),
  storage_path: storagePathSchema.optional(),
});

const orchestratorBodySchema = strictObject({
  key: z.string().trim().min(1).max(200).optional(),
  name: nameSchema,
  storage_path: storagePathSchema,
  model: modelSchema,
});

const orchestratorPatchSchema = strictObject({
  name: nameSchema.optional(),
  storage_path: storagePathSchema.optional(),
  model: modelSchema.optional(),
});

const agentBodySchema = strictObject({
  key: z.string().trim().min(1).max(200).optional(),
  name: nameSchema,
  role: roleSchema,
  model: modelSchema,
  storage_path: storagePathSchema,
});

const agentPatchSchema = strictObject({
  name: nameSchema.optional(),
  role: roleSchema.optional(),
  model: modelSchema.optional(),
  storage_path: storagePathSchema.optional(),
});

const capabilityBodySchema = strictObject({
  key: z.string().trim().min(1).max(200).optional(),
  name: nameSchema,
  storage_path: storagePathSchema,
});

const capabilityPatchSchema = strictObject({
  name: nameSchema.optional(),
  storage_path: storagePathSchema.optional(),
});

const linkCapabilityBodySchema = strictObject({
  capability_id: z.string().trim().min(1),
});

function nowIso() {
  return new Date().toISOString();
}

function defaultMindName(userId: string) {
  return `Mind ${userId.slice(0, 8)}`;
}

function defaultMindStoragePath(userId: string) {
  return `users/${userId}/mind`;
}

async function requireUserId(c: Context) {
  const userId = await getUserId(c);
  if (!userId) {
    return { error: c.json({ error: 'authentication required' }, 401) };
  }
  return { userId };
}

async function requireSuperAdmin(c: Context) {
  const auth = await getAuthIdentity(c);
  if (!auth) {
    return { error: c.json({ error: 'authentication required' }, 401) };
  }
  const user = await getUserById(auth.key);
  if (user?.organization_role !== 'owner') {
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

function mindResponse(mind: Awaited<ReturnType<typeof getMindByUserId>> extends infer T ? NonNullable<T> : never) {
  return {
    id: mind.key,
    user_id: mind.userId,
    name: mind.name,
    storage_path: mind.storagePath,
    created_at: mind.createdAt,
    updated_at: mind.updatedAt,
  };
}

function orchestratorResponse(orchestrator: Awaited<ReturnType<typeof getOrchestratorById>> extends infer T ? NonNullable<T> : never) {
  return {
    id: orchestrator.key,
    name: orchestrator.name,
    storage_path: orchestrator.storagePath,
    model: orchestrator.model,
    created_at: orchestrator.createdAt,
    updated_at: orchestrator.updatedAt,
  };
}

function agentResponse(agent: Awaited<ReturnType<typeof getAgentById>> extends infer T ? NonNullable<T> : never) {
  return {
    id: agent.key,
    orchestrator_id: agent.orchestratorId,
    name: agent.name,
    role: agent.role,
    model: agent.model,
    storage_path: agent.storagePath,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}

function capabilityResponse(capability: Awaited<ReturnType<typeof getCapabilityById>> extends infer T ? NonNullable<T> : never) {
  return {
    id: capability.key,
    name: capability.name,
    storage_path: capability.storagePath,
    created_at: capability.createdAt,
    updated_at: capability.updatedAt,
  };
}

export async function getCurrentMind(c: Context) {
  const auth = await requireUserId(c);
  if ('error' in auth) return auth.error;

  const mind = await getMindByUserId(auth.userId);
  if (!mind) return c.json({ error: 'mind not found' }, 404);
  return c.json(mindResponse(mind));
}

export async function upsertCurrentMind(c: Context) {
  const auth = await requireUserId(c);
  if ('error' in auth) return auth.error;

  const body = await parseJson(c, mindBodySchema);
  const existing = await getMindByUserId(auth.userId);
  const timestamp = nowIso();

  try {
    if (existing) {
      const mind = await updateMind(existing.key, {
        name: body.name ?? existing.name,
        storagePath: body.storage_path ?? existing.storagePath,
        updatedAt: timestamp,
      });
      return c.json(mindResponse(mind));
    }

    const mind = await insertMind({
      key: newId(),
      userId: auth.userId,
      name: body.name ?? defaultMindName(auth.userId),
      storagePath: body.storage_path ?? defaultMindStoragePath(auth.userId),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json(mindResponse(mind), 201);
  } catch (err) {
    return uniqueConflict(c, err, 'a mind already exists for this user');
  }
}

export async function listCurrentMindCapabilities(c: Context) {
  const auth = await requireUserId(c);
  if ('error' in auth) return auth.error;

  const mind = await getMindByUserId(auth.userId);
  if (!mind) return c.json({ error: 'mind not found' }, 404);

  const links = await listMindCapabilitiesByMindId(mind.key);
  const capabilities = await Promise.all(links.map((link) => getCapabilityById(link.capabilityId)));
  return c.json({
    mind: mindResponse(mind),
    items: links.map((link, index) => ({
      id: link.key,
      mind_id: link.mindId,
      capability_id: link.capabilityId,
      capability: capabilities[index] ? capabilityResponse(capabilities[index]) : null,
      created_at: link.createdAt,
      updated_at: link.updatedAt,
    })),
  });
}

export async function attachCurrentMindCapability(c: Context) {
  const auth = await requireUserId(c);
  if ('error' in auth) return auth.error;

  const body = await parseJson(c, linkCapabilityBodySchema);
  const mind = await getMindByUserId(auth.userId);
  if (!mind) return c.json({ error: 'mind not found' }, 404);

  const capability = await getCapabilityById(body.capability_id);
  if (!capability) return c.json({ error: 'capability not found' }, 404);

  const existing = await getMindCapabilityByPair(mind.key, capability.key);
  if (existing) {
    return c.json({
      id: existing.key,
      mind_id: existing.mindId,
      capability_id: existing.capabilityId,
      capability: capabilityResponse(capability),
      created_at: existing.createdAt,
      updated_at: existing.updatedAt,
    });
  }

  const timestamp = nowIso();
  try {
    const link = await insertMindCapability({
      key: newId(),
      mindId: mind.key,
      capabilityId: capability.key,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json({
      id: link.key,
      mind_id: link.mindId,
      capability_id: link.capabilityId,
      capability: capabilityResponse(capability),
      created_at: link.createdAt,
      updated_at: link.updatedAt,
    }, 201);
  } catch (err) {
    return uniqueConflict(c, err, 'capability is already attached to this mind');
  }
}

export async function detachCurrentMindCapability(c: Context) {
  const auth = await requireUserId(c);
  if ('error' in auth) return auth.error;

  const capabilityParam = requiredParam(c, 'capabilityId');
  if ('error' in capabilityParam) return capabilityParam.error;
  const mind = await getMindByUserId(auth.userId);
  if (!mind) return c.json({ error: 'mind not found' }, 404);

  const existing = await getMindCapabilityByPair(mind.key, capabilityParam.value);
  if (!existing) return c.json({ error: 'mind capability link not found' }, 404);

  await deleteMindCapability(existing.key);
  return c.json({ ok: true });
}

export async function listSystemOrchestrators(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const query = parseQuery(c, pageQuerySchema);
  const { items, nextCursor } = await listOrchestratorsPage(query.after, query.limit);
  const agents = await Promise.all(items.map((orchestrator) => listAgentsByOrchestratorId(orchestrator.key)));
  return c.json({
    items: items.map((orchestrator, index) => ({
      ...orchestratorResponse(orchestrator),
      agents: agents[index].map(agentResponse),
    })),
    next_cursor: nextCursor,
  });
}

export async function createSystemOrchestrator(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const body = await parseJson(c, orchestratorBodySchema);
  const timestamp = nowIso();
  try {
    const orchestrator = await insertOrchestrator({
      key: body.key ?? newId(),
      name: body.name,
      storagePath: body.storage_path,
      model: body.model,
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
  const updated = await updateOrchestrator(orchestrator.key, {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.storage_path === undefined ? {} : { storagePath: body.storage_path }),
    ...(body.model === undefined ? {} : { model: body.model }),
    updatedAt: nowIso(),
  });
  return c.json(orchestratorResponse(updated));
}

export async function listSystemAgents(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const query = parseQuery(c, pageQuerySchema.extend({
    orchestrator_id: z.string().trim().min(1).optional(),
  }));

  if (query.orchestrator_id) {
    const orchestrator = await getOrchestratorById(query.orchestrator_id);
    if (!orchestrator) return c.json({ error: 'orchestrator not found' }, 404);
    return c.json({ items: (await listAgentsByOrchestratorId(orchestrator.key)).map(agentResponse), next_cursor: null });
  }

  const { items, nextCursor } = await listAgentsPage(query.after, query.limit);
  return c.json({ items: items.map(agentResponse), next_cursor: nextCursor });
}

export async function createSystemAgent(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const orchestratorParam = requiredParam(c, 'orchestratorId');
  if ('error' in orchestratorParam) return orchestratorParam.error;

  const orchestrator = await getOrchestratorById(orchestratorParam.value);
  if (!orchestrator) return c.json({ error: 'orchestrator not found' }, 404);

  const body = await parseJson(c, agentBodySchema);
  const timestamp = nowIso();
  try {
    const agent = await insertAgent({
      key: body.key ?? newId(),
      orchestratorId: orchestrator.key,
      name: body.name,
      role: body.role,
      model: body.model,
      storagePath: body.storage_path,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json(agentResponse(agent), 201);
  } catch (err) {
    return uniqueConflict(c, err, 'agent key or orchestrator/name pair already exists');
  }
}

export async function updateSystemAgent(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const agentParam = requiredParam(c, 'agentId');
  if ('error' in agentParam) return agentParam.error;

  const agent = await getAgentById(agentParam.value);
  if (!agent) return c.json({ error: 'agent not found' }, 404);

  const body = await parseJson(c, agentPatchSchema);
  const updated = await updateAgent(agent.key, {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.role === undefined ? {} : { role: body.role }),
    ...(body.model === undefined ? {} : { model: body.model }),
    ...(body.storage_path === undefined ? {} : { storagePath: body.storage_path }),
    updatedAt: nowIso(),
  });
  return c.json(agentResponse(updated));
}

export async function listSystemCapabilities(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const query = parseQuery(c, pageQuerySchema);
  const { items, nextCursor } = await listCapabilitiesPage(query.after, query.limit);
  return c.json({ items: items.map(capabilityResponse), next_cursor: nextCursor });
}

export async function createSystemCapability(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const body = await parseJson(c, capabilityBodySchema);
  const timestamp = nowIso();
  try {
    const capability = await insertCapability({
      key: body.key ?? newId(),
      name: body.name,
      storagePath: body.storage_path,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return c.json(capabilityResponse(capability), 201);
  } catch (err) {
    return uniqueConflict(c, err, 'capability key already exists');
  }
}

export async function updateSystemCapability(c: Context) {
  const admin = await requireSuperAdmin(c);
  if ('error' in admin) return admin.error;

  const capabilityParam = requiredParam(c, 'capabilityId');
  if ('error' in capabilityParam) return capabilityParam.error;

  const capability = await getCapabilityById(capabilityParam.value);
  if (!capability) return c.json({ error: 'capability not found' }, 404);

  const body = await parseJson(c, capabilityPatchSchema);
  const updated = await updateCapability(capability.key, {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.storage_path === undefined ? {} : { storagePath: body.storage_path }),
    updatedAt: nowIso(),
  });
  return c.json(capabilityResponse(updated));
}
