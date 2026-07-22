import { z } from 'zod';
import { countUsers, getUserByAliasSlug, getUserByEmailHash, insertUser, updateUser, type User } from '@/lib/db/users.node';
import { getVisitorByDistinctId, type Visitor } from '@/lib/db/visitors.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '@/lib/alias';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { getRootOrganizationId } from '@/platform/events';

export function normalizeEmail(email: string) {
  return z.string().email().parse(email.trim().toLowerCase());
}

export function defaultNameFromEmail(email: string) {
  const localPart = email.trim().split('@')[0] ?? '';
  const firstName = (localPart.split('.')[0] ?? localPart).replace(/[^a-zA-Z'-]/g, '');
  if (!firstName) return null;
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

export async function hashUserEmail(email: string) {
  return sha256(normalizeEmail(email));
}

/**
 * The anonymous visitor node this signup has been exploring the galaxy as.
 * Visitors are anonymous by definition now (no emailHash/userId), so the
 * only durable link at conversion is the distinct-id cookie — used purely
 * to carry the explorer's alias over onto the new user.
 */
async function findVisitorForConversion(distinctId: string | null): Promise<Visitor | null> {
  return distinctId ? getVisitorByDistinctId(distinctId) : null;
}

async function createUniqueAliasSlug(alias: string, userKey: string): Promise<string> {
  for (let attempt = 0; attempt < ALIAS_SLUG_PREFIX_SPACE; attempt += 1) {
    const candidate = generateAliasSlug(alias, userKey, attempt);
    const existing = await getUserByAliasSlug(candidate);
    if (!existing || existing.key === userKey) return candidate;
  }
  throw new Error(`Could not allocate alias_slug for user ${userKey}`);
}

export async function upsertUserByEmail(
  email: string,
  values: Partial<Omit<User, 'key' | 'email' | 'emailHash'>> = {},
  options: { distinctId?: string | null } = {},
): Promise<User> {
  const normalized = normalizeEmail(email);
  const emailHash = await hashUserEmail(normalized);
  const now = new Date().toISOString();
  const organizationId = values.organizationId ?? await getRootOrganizationId();
  // The alias travels: whoever explored the galaxy as this anonymous visitor
  // keeps the same "<Prefix> <Role>" identity when they become a user.
  const visitor = await findVisitorForConversion(options.distinctId ?? null);

  async function reconcileWithExisting(existing: User): Promise<User> {
    const patch: Partial<User> = { ...values, organizationId, email: normalized, emailHash, updatedAt: now };
    // Country is captured at account creation, not rewritten by later sign-ins.
    delete patch.countryCode;
    if (patch.name === undefined) delete patch.name;
    if (patch.alias === undefined && existing.alias == null && visitor?.alias) {
      patch.alias = visitor.alias;
    }
    const alias = patch.alias ?? existing.alias ?? generateAlias(existing.key);
    if (existing.alias == null && patch.alias === undefined) {
      patch.alias = alias;
    }
    if (patch.alias_slug === undefined && existing.alias_slug == null) {
      patch.alias_slug = await createUniqueAliasSlug(alias, existing.key);
    }
    return updateUser(existing.key, patch);
  }

  const existing = await getUserByEmailHash(emailHash);
  if (existing) return reconcileWithExisting(existing);

  // Exact-once precision on the waitlist number is not critical; a COUNT
  // right before the insert is close enough for a marketing counter.
  const key = newId();
  const waitlistNumber = values.waitlistNumber ?? (await countUsers()) + 1;
  const alias = values.alias ?? visitor?.alias ?? generateAlias(key);
  try {
    return await insertUser({
      key,
      ...values,
      organizationId,
      email: normalized,
      emailHash,
      name: values.name ?? defaultNameFromEmail(normalized),
      alias,
      alias_slug: values.alias_slug ?? await createUniqueAliasSlug(alias, key),
      waitlistNumber,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    // Two concurrent upserts for the same brand-new email (a double-tapped
    // "Continue with Google", a retried OAuth callback, or a magic-link
    // request racing an OAuth callback for the same address) can both pass
    // the emailHash lookup above before either has inserted. The unique
    // index on emailHash is the real backstop here — resolve to whichever
    // row won the race instead of surfacing a raw 500 (same pattern as the
    // other emailHash/idempotency-key races handled elsewhere, e.g.
    // payments.ts checkout creation).
    if (!isArangoUniqueConstraintError(err)) throw err;
    const winner = await getUserByEmailHash(emailHash);
    if (!winner) throw err;
    return reconcileWithExisting(winner);
  }
}
