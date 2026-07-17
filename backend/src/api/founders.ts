import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  FoundersAccessError,
  listAccessibleOrganizations,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireOrganizationAccess,
  requireScopeAccess,
  type FoundersGateAccess,
} from '@/lib/founders/access';
import {
  BEACON_ASK_MAX_MESSAGE_LENGTH,
  BeaconUnavailableError,
  streamFoundersBeaconAsk,
} from '@/lib/ai/beacon/ask';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError } from '@/lib/ai/router';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

/**
 * Founders Gate: the founder-facing surface. Every handler independently
 * re-resolves the authenticated user and verifies root-organization,
 * organization, and scope access from canonical database state — the
 * frontend's route guard is presentation only. Client payloads may name an
 * organization, a scope, and a message; user, agent, model, provider, role,
 * and permission resolution is exclusively server-side.
 */

const cuidParamSchema = z.string().cuid();

export const foundersBeaconAskSchema = strictObject({
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  message: z.string().trim().min(1).max(BEACON_ASK_MAX_MESSAGE_LENGTH),
});

const BEACON_ASK_TIMEOUT_MS = 120_000;
const BEACON_ASK_RATE_LIMIT_PER_MINUTE = 12;

type FounderContext = FoundersGateAccess & { identityType: 'user' | 'member' | 'superAdmin' };

async function requireFounder(c: Context): Promise<{ founder: FounderContext } | { error: Response }> {
  const identity = await getAuthIdentity(c);
  if (!identity) return { error: c.json({ error: 'authentication required' }, 401) };
  try {
    const access = await requireFoundersGateAccess(identity.key);
    return { founder: { ...access, identityType: identity.identityType } };
  } catch (error) {
    if (error instanceof FoundersAccessError) {
      return { error: c.json({ error: 'founders gate access required' }, 403) };
    }
    throw error;
  }
}

function forbidden(c: Context, error: unknown): Response {
  if (error instanceof FoundersAccessError) {
    const message = error.code === 'scope_forbidden' ? 'scope access denied' : 'organization access denied';
    return c.json({ error: message }, 403);
  }
  throw error;
}

/** GET /founders/me — identity and role data for the account surface. */
export async function getFoundersAccount(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const { user, rootOrganization, rootMembership, identityType } = auth.founder;
  return c.json({
    user: {
      key: user.key,
      name: user.name,
      alias: user.alias,
      email: user.email,
    },
    rootOrganization: {
      key: rootOrganization.key,
      name: rootOrganization.name,
      alias: rootOrganization.slug ?? null,
    },
    rootMembership: {
      role: rootMembership.orgRole,
      title: rootMembership.orgTitle,
    },
    applicationRole: identityType,
  });
}

/** GET /founders/organizations — organizations the founder already belongs to. */
export async function listFoundersOrganizations(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const organizations = await listAccessibleOrganizations(auth.founder.user.key);
  return c.json({ organizations });
}

/** GET /founders/organizations/:organizationKey/scopes — accessible scopes inside one organization. */
export async function listFoundersOrganizationScopes(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const parsedKey = cuidParamSchema.safeParse(c.req.param('organizationKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid organization key' }, 400);
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, parsedKey.data);
    const scopes = await listAccessibleScopes(membership);
    return c.json({ scopes });
  } catch (error) {
    return forbidden(c, error);
  }
}

async function askRateLimited(userKey: string): Promise<boolean> {
  if (process.env.RATE_LIMIT_ENABLED !== 'true') return false;
  const { redisConnection } = await import('@/lib/redis');
  const windowSeconds = 60;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rate-limit:founders-beacon:${userKey}:${bucket}`;
  const count = await redisConnection.incr(key);
  if (count === 1) await redisConnection.expire(key, windowSeconds + 10);
  return count > BEACON_ASK_RATE_LIMIT_PER_MINUTE;
}

/**
 * POST /founders/beacon/ask — SSE stream of one isolated Beacon run.
 * Events: response.started, response.delta {text}, response.completed,
 * response.failed {error}. Only user-facing text is ever streamed.
 */
export async function askFoundersBeacon(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const body = await parseJson(c, foundersBeaconAskSchema);

  let organizationAccess;
  let scopeAccess;
  try {
    organizationAccess = await requireOrganizationAccess(auth.founder.user.key, body.organizationKey);
    scopeAccess = await requireScopeAccess(organizationAccess.membership, body.scopeKey);
  } catch (error) {
    return forbidden(c, error);
  }

  if (await askRateLimited(auth.founder.user.key)) {
    return c.json({ error: 'rate limit exceeded' }, 429);
  }

  const { organization, membership } = organizationAccess;
  const { scope } = scopeAccess;
  const user = auth.founder.user;

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    const events = streamFoundersBeaconAsk(
      { organization, scope, membership, user, message: body.message },
      { signal: controller.signal, timeoutMs: BEACON_ASK_TIMEOUT_MS },
    );
    try {
      for await (const event of events) {
        if (event.type === 'started') {
          await stream.writeSSE({ event: 'response.started', data: '{}' });
        } else if (event.type === 'delta') {
          await stream.writeSSE({ event: 'response.delta', data: JSON.stringify({ text: event.text }) });
        } else {
          await stream.writeSSE({ event: 'response.completed', data: '{}' });
        }
      }
    } catch (error) {
      // Log the technical detail server-side; the browser gets a safe line.
      console.warn('founders beacon ask failed', {
        userKey: user.key,
        organizationKey: organization.key,
        scopeKey: scope.key,
        error: error instanceof Error ? error.message : String(error),
      });
      const unavailable = error instanceof BeaconUnavailableError
        || error instanceof NoEligibleRouteError
        || error instanceof ProviderNotEnabledForOrganizationError;
      const message = unavailable
        ? 'Beacon is not available in this scope.'
        : 'Beacon could not complete the response.';
      await stream.writeSSE({ event: 'response.failed', data: JSON.stringify({ error: message }) }).catch(() => {});
    }
  });
}
