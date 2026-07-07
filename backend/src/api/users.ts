import { z } from 'zod';
import { countUsers, getUserByEmailHash, insertUser, updateUser, type User } from '@/lib/db/users.node';
import {
  getVisitorByDistinctId,
  getVisitorByEmailHash,
  updateVisitor,
  type Visitor,
} from '@/lib/db/visitors.node';
import { generateAlias } from '@/lib/alias';
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

/** The visitor node this identity has been exploring the galaxy as. */
async function findVisitorForIdentity(emailHash: string, distinctId: string | null): Promise<Visitor | null> {
  const byEmail = await getVisitorByEmailHash(emailHash);
  if (byEmail) return byEmail;
  return distinctId ? getVisitorByDistinctId(distinctId) : null;
}

/** A visitor became (or already is) a user: link them and keep aliases in sync. */
async function linkVisitorToUser(visitor: Visitor, user: User): Promise<void> {
  const patch: Partial<Omit<Visitor, 'key' | 'embedding'>> = {};
  if (visitor.userId !== user.key) patch.userId = user.key;
  if (visitor.emailHash == null) patch.emailHash = user.emailHash;
  if (user.alias && visitor.alias !== user.alias) patch.alias = user.alias;
  if (Object.keys(patch).length === 0) return;
  try {
    await updateVisitor(visitor.key, { ...patch, updatedAt: new Date().toISOString() });
  } catch (error) {
    // Unique index races (another visitor already holds this emailHash)
    // are harmless here — the presence layer reconciles on next join.
    console.warn('failed to link visitor to user', error instanceof Error ? error.message : String(error));
  }
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
  // The alias travels: whoever explored the galaxy as this visitor keeps
  // the same "<Prefix> <Role>" identity when they become a user.
  const visitor = await findVisitorForIdentity(emailHash, options.distinctId ?? null);

  const existing = await getUserByEmailHash(emailHash);
  if (existing) {
    const patch: Partial<User> = { ...values, platformId, email: normalized, emailHash, updatedAt: now };
    if (patch.name === undefined) delete patch.name;
    if (patch.alias === undefined && existing.alias == null && visitor?.alias) {
      patch.alias = visitor.alias;
    }
    const updated = await updateUser(existing.key, patch);
    if (visitor) await linkVisitorToUser(visitor, updated);
    return updated;
  }

  // Exact-once precision on the waitlist number is not critical; a COUNT
  // right before the insert is close enough for a marketing counter.
  const key = newId();
  const waitlistNumber = values.waitlistNumber ?? (await countUsers()) + 1;
  const created = await insertUser({
    key,
    ...values,
    platformId,
    email: normalized,
    emailHash,
    name: values.name ?? defaultNameFromEmail(normalized),
    alias: values.alias ?? visitor?.alias ?? generateAlias(key),
    waitlistNumber,
    createdAt: now,
    updatedAt: now,
  });
  if (visitor) await linkVisitorToUser(visitor, created);
  return created;
}
