import { z } from 'zod';
import { getUserByEmailHash, insertUser, updateUser, type User } from '@/lib/db/users.node';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';

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

  const existing = await getUserByEmailHash(emailHash);
  if (existing) {
    const patch: Partial<User> = { ...values, email: normalized, emailHash, updatedAt: now };
    if (patch.name === undefined) delete patch.name;
    return updateUser(existing.key, patch);
  }

  return insertUser({
    key: newId(),
    ...values,
    email: normalized,
    emailHash,
    name: values.name ?? defaultNameFromEmail(normalized),
    createdAt: now,
    updatedAt: now,
  });
}
