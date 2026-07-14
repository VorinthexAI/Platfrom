import { z } from 'zod';

/**
 * Named scopes that guardrails point at (a guardrail contains ONLY a
 * scopeId). Scopes are the unit an agent's guardrails allow-list — tools
 * declare the scope they operate in, and a guardrailed agent may only use
 * tools whose scope its guardrails include. Named per the repo's
 * camelCase-plural collection convention (the legacy organization_scopes
 * name is migrated in arango-migrate).
 */
export const ORGANIZATION_SCOPES_COLLECTION = 'organizationScopes';

/**
 * Intentionally minimal node per the spec: a CUID key and a name. Keys are
 * generated with the repo's CUID2 id helper. Parses in zod's default strip
 * mode so Arango system attributes drop away on read; the public
 * primary-key field is always `key`, never `_key`.
 */
export const organizationScopeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
});

export type OrganizationScope = z.infer<typeof organizationScopeSchema>;
