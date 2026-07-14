import { z } from 'zod';

/**
 * Named scopes that guardrails point at (a guardrail contains ONLY a
 * scopeId). A scope belongs to exactly one organization: tools declare the
 * scope they operate in, and a guardrailed agent may only use tools whose
 * scope its guardrails include. Renamed from the legacy organizationScopes
 * collection (dropped in arango-migrate).
 */
export const SCOPES_COLLECTION = 'scopes';

/** Parent to child links arranging an organization's scopes into a tree. */
export const SCOPE_CHILDREN_COLLECTION = 'scopeChildren';

/** Membership links: one document places one user inside one scope. */
export const SCOPE_USERS_COLLECTION = 'scopeUsers';

/**
 * Parses in zod's default strip mode so Arango system attributes
 * (`_key`/`_id`/`_rev`) drop away on read; the public primary-key field is
 * always `key`, never `_key` (only the shared base.ts translators touch it).
 */
export const scopeSchema = z.object({
  key: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Backfilled by arango-migrate from embedKeys (name + description). */
  embedding: z.array(z.number()).default([]),
});

export type Scope = z.infer<typeof scopeSchema>;

export const scopeChildSchema = z.object({
  key: z.string().min(1),
  parentScopeId: z.string().min(1),
  childScopeId: z.string().min(1),
  /** Pure link node — nothing to embed; normalized to [] by arango-migrate. */
  embedding: z.array(z.number()).default([]),
});

export type ScopeChild = z.infer<typeof scopeChildSchema>;

export const scopeUserSchema = z.object({
  key: z.string().min(1),
  scopeId: z.string().min(1),
  userId: z.string().min(1),
  /** Pure link node — nothing to embed; normalized to [] by arango-migrate. */
  embedding: z.array(z.number()).default([]),
});

export type ScopeUser = z.infer<typeof scopeUserSchema>;

/**
 * Deterministic keys for the link documents — writes stay idempotent and
 * removals addressable by key. The unique persistent indexes on the id
 * pairs remain the database-level guarantee against duplicates.
 */
export function scopeChildKey(parentScopeId: string, childScopeId: string): string {
  return `${parentScopeId}:${childScopeId}`;
}

export function scopeUserKey(scopeId: string, userId: string): string {
  return `${scopeId}:${userId}`;
}
