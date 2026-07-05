import { z } from 'zod';
import { getMemberByUserId, insertMember, updateMember, type Member } from '@/lib/db/members.node';
import { getUserByEmailHash, insertUser, updateUser, type User } from '@/lib/db/users.node';
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

export async function upsertUserByEmail(email: string, values: Partial<Omit<User, 'key' | 'email' | 'emailHash'>> = {}): Promise<User> {
  const normalized = normalizeEmail(email);
  const emailHash = await hashUserEmail(normalized);
  const now = new Date().toISOString();
  const platformId = values.platformId ?? await getDefaultPlatformId();

  const existing = await getUserByEmailHash(emailHash);
  if (existing) {
    const patch: Partial<User> = { ...values, platformId, email: normalized, emailHash, updatedAt: now };
    if (patch.name === undefined) delete patch.name;
    return updateUser(existing.key, patch);
  }

  return insertUser({
    key: newId(),
    ...values,
    platformId,
    email: normalized,
    emailHash,
    name: values.name ?? defaultNameFromEmail(normalized),
    createdAt: now,
    updatedAt: now,
  });
}

export async function upsertMemberForUser(
  user: Pick<User, 'key' | 'platformId' | 'email' | 'emailHash' | 'name' | 'profileUrl' | 'createdAt'>,
  values: Partial<Omit<Member, 'key' | 'platformId' | 'userId' | 'email' | 'emailHash' | 'embedding' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Member> {
  const now = new Date().toISOString();
  const existing = await getMemberByUserId(user.key);
  const base = {
    platformId: user.platformId,
    email: user.email,
    emailHash: user.emailHash,
    name: values.name ?? user.name,
    profileUrl: values.profileUrl ?? user.profileUrl,
  };

  if (existing) {
    return updateMember(existing.key, { ...base, ...values, updatedAt: now });
  }

  return insertMember({
    key: newId(),
    userId: user.key,
    ...base,
    ...values,
    createdAt: user.createdAt,
    updatedAt: now,
  });
}
