import { z } from 'zod';
import { countUsers, getUserByAliasSlug, getUserByEmailHash, insertUser, updateUser, type User } from '@/lib/db/users.node';
import { getVisitorByDistinctId, type Visitor } from '@/lib/db/visitors.node';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '@/lib/alias';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { getDefaultPlatformId } from '@/platform/events';

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
  const platformId = values.platformId ?? await getDefaultPlatformId();
  // The alias travels: whoever explored the galaxy as this anonymous visitor
  // keeps the same "<Prefix> <Role>" identity when they become a user.
  const visitor = await findVisitorForConversion(options.distinctId ?? null);

  const existing = await getUserByEmailHash(emailHash);
  if (existing) {
    const patch: Partial<User> = { ...values, platformId, email: normalized, emailHash, updatedAt: now };
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

  // Exact-once precision on the waitlist number is not critical; a COUNT
  // right before the insert is close enough for a marketing counter.
  const key = newId();
  const waitlistNumber = values.waitlistNumber ?? (await countUsers()) + 1;
  const alias = values.alias ?? visitor?.alias ?? generateAlias(key);
  const created = await insertUser({
    key,
    ...values,
    platformId,
    email: normalized,
    emailHash,
    name: values.name ?? defaultNameFromEmail(normalized),
    alias,
    alias_slug: values.alias_slug ?? await createUniqueAliasSlug(alias, key),
    waitlistNumber,
    createdAt: now,
    updatedAt: now,
  });
  return created;
}
