import type { Context } from 'hono';
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
import { getDefaultOrganizationCredentialsRepository } from '@/lib/ai/organization-credentials';
import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers';
import { getProviderBySlug } from '@/lib/db/providers.node';
import {
  PROVIDER_SLUGS,
  anthropicCredentialsSchema,
  awsBedrockCredentialsSchema,
  awsPollyCredentialsSchema,
  awsTranscribeCredentialsSchema,
  azureAIFoundryCredentialsSchema,
  googleVertexCredentialsSchema,
  openAICredentialsSchema,
  openRouterCredentialsSchema,
  providerSlugSchema,
  xaiCredentialsSchema,
  type ProviderSlug,
} from '@/lib/ai/providers';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { getOrchestratorById } from '@/lib/db/orchestrators.node';

/**
 * Founders Gate: the founder-facing surface. Every handler independently
 * re-resolves the authenticated user and verifies root-organization,
 * organization, and scope access from canonical database state — the
 * frontend's route guard is presentation only. Client payloads may name an
 * organization, a scope, and a message; user, agent, model, provider, role,
 * and permission resolution is exclusively server-side.
 */

export const foundersOrganizationKeyParamSchema = z.string().trim().min(1).max(160);


export const foundersProviderCredentialsBodySchema = strictObject({ credentials: z.unknown() });
export const foundersProviderCredentialsSchemas: Record<ProviderSlug, z.ZodTypeAny> = {
  openai: openAICredentialsSchema,
  anthropic: anthropicCredentialsSchema,
  xai: xaiCredentialsSchema,
  'google-vertex': googleVertexCredentialsSchema,
  'azure-ai-foundry': azureAIFoundryCredentialsSchema,
  'aws-bedrock': awsBedrockCredentialsSchema,
  'aws-polly': awsPollyCredentialsSchema,
  'aws-transcribe': awsTranscribeCredentialsSchema,
  openrouter: openRouterCredentialsSchema,
};

function parseFounderProviderCredentials(provider: ProviderSlug, credentials: unknown) {
  return foundersProviderCredentialsSchemas[provider].parse(credentials);
}


export type FounderContext = FoundersGateAccess & { identityType: 'user' | 'member' | 'superAdmin' };

export async function requireFounder(c: Context): Promise<{ founder: FounderContext } | { error: Response }> {
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

export function forbidden(c: Context, error: unknown): Response {
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
  const orchestrator = rootMembership.orchestratorKey
    ? await getOrchestratorById(rootMembership.orchestratorKey)
    : null;
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
      orchestrator: orchestrator ? { key: orchestrator.key, slug: orchestrator.name.toLowerCase() } : null,
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
  const parsedKey = foundersOrganizationKeyParamSchema.safeParse(c.req.param('organizationKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid organization key' }, 400);
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, parsedKey.data);
    const scopes = await listAccessibleScopes(membership);
    return c.json({ scopes });
  } catch (error) {
    return forbidden(c, error);
  }
}

/** GET /founders/organizations/:organizationKey/providers — owner-visible provider connection status only. */
export async function listFoundersOrganizationProviders(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const parsedKey = foundersOrganizationKeyParamSchema.safeParse(c.req.param('organizationKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid organization key' }, 400);
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, parsedKey.data);
    if (membership.orgRole !== 'owner') return c.json({ error: 'organization owner role required' }, 403);
    const links = getDefaultOrganizationProviderRepository();
    const credentials = getDefaultOrganizationCredentialsRepository();
    const providers = await Promise.all(PROVIDER_SLUGS.map(async (provider) => {
      const canonical = await getProviderBySlug(provider);
      if (!canonical) return { provider, linked: false, credentialsConfigured: false };
      const [linked, credentialsConfigured] = await Promise.all([
        links.hasProvider(parsedKey.data, canonical.key),
        credentials.hasCredentials(parsedKey.data, canonical.key),
      ]);
      return { provider, linked, credentialsConfigured };
    }));
    return c.json({ providers });
  } catch (error) {
    return forbidden(c, error);
  }
}

/** PUT /founders/organizations/:organizationKey/providers/:provider — owner-only credential connect/update. */
export async function upsertFoundersOrganizationProvider(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const organizationKey = foundersOrganizationKeyParamSchema.safeParse(c.req.param('organizationKey'));
  const provider = providerSlugSchema.safeParse(c.req.param('provider'));
  if (!organizationKey.success) return c.json({ error: 'invalid organization key' }, 400);
  if (!provider.success) return c.json({ error: 'invalid provider' }, 400);
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, organizationKey.data);
    if (membership.orgRole !== 'owner') return c.json({ error: 'organization owner role required' }, 403);
    const body = await parseJson(c, foundersProviderCredentialsBodySchema);
    const parsedCredentials = parseFounderProviderCredentials(provider.data, body.credentials);
    const canonical = await getProviderBySlug(provider.data);
    if (!canonical) return c.json({ error: 'provider unavailable' }, 404);
    await getDefaultOrganizationProviderRepository().upsertProvider(organizationKey.data, {
      providerKey: canonical.key,
      name: canonical.name,
      description: null,
    });
    await getDefaultOrganizationCredentialsRepository().setCredentials(organizationKey.data, canonical.key, parsedCredentials);
    return c.json({ provider: provider.data, linked: true, credentialsConfigured: true });
  } catch (error) {
    return forbidden(c, error);
  }
}
