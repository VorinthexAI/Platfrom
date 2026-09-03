import { z, ZodError } from 'zod';
import { updateUser, type User } from '@/lib/db/users.node';
import { replaceUserProfileStorageKey, type ProfileReplacement } from './repository';

const authenticatedUserKeySchema = z.string().cuid();
export const profileNameUpdateInputSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export const profileAvatarReplacementInputSchema = z.object({ storageKey: z.string().trim().min(1) }).strict();
export const safeProfileUpdateResultSchema = z.object({ profile: z.object({ name: z.string().trim().min(1).max(200) }).strict() }).strict();

export type AccountProfile = Pick<User, 'key' | 'name' | 'updatedAt'> & { profileStorageKey: string | null };
type ProfileUserRecord = Pick<User, 'key' | 'name' | 'updatedAt'> & { profileStorageKey?: string | null };

export interface AccountProfileServiceDependencies {
  updateUser?: (userKey: string, patch: { name: string; updatedAt: string }) => Promise<ProfileUserRecord>;
  replaceStorageKey?: (userKey: string, storageKey: string, updatedAt: string) => Promise<ProfileReplacement | null>;
  now?: () => Date;
}

export class AccountProfileError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 500, readonly code: string, message: string) {
    super(message);
    this.name = 'AccountProfileError';
  }
}

export function normalizeAccountProfileError(error: unknown) {
  if (error instanceof AccountProfileError) return error;
  if (error instanceof ZodError || error instanceof SyntaxError) return new AccountProfileError(400, 'PROFILE_INVALID_INPUT', 'Profile request input was invalid.');
  return new AccountProfileError(500, 'PROFILE_FAILED', 'Profile request failed.');
}

function projectProfile(user: ProfileUserRecord): AccountProfile {
  return { key: user.key, name: user.name, profileStorageKey: user.profileStorageKey ?? null, updatedAt: user.updatedAt };
}

export interface AccountProfileService {
  updateName(input: unknown, authenticatedUserKey: string): Promise<{ profile: AccountProfile }>;
  replaceAvatar(input: unknown, authenticatedUserKey: string): Promise<{ profile: AccountProfile; previousStorageKey: string | null }>;
}

export function createAccountProfileService(dependencies: AccountProfileServiceDependencies = {}): AccountProfileService {
  const now = dependencies.now ?? (() => new Date());
  return {
    async updateName(rawInput, authenticatedUserKey) {
      const userKey = authenticatedUserKeySchema.parse(authenticatedUserKey);
      const input = profileNameUpdateInputSchema.parse(rawInput);
      const update = dependencies.updateUser ?? (updateUser as unknown as NonNullable<AccountProfileServiceDependencies['updateUser']>);
      const user = await update(userKey, { name: input.name, updatedAt: now().toISOString() });
      return { profile: projectProfile(user) };
    },

    async replaceAvatar(rawInput, authenticatedUserKey) {
      const userKey = authenticatedUserKeySchema.parse(authenticatedUserKey);
      const input = profileAvatarReplacementInputSchema.parse(rawInput);
      const segments = input.storageKey.split('/');
      const objectId = segments.length === 3 && segments[0] === 'profiles' && segments[1] === userKey && segments[2]?.endsWith('.png')
        ? segments[2].slice(0, -4)
        : undefined;
      if (!objectId || !z.string().cuid().safeParse(objectId).success) throw new AccountProfileError(400, 'PROFILE_INVALID_STORAGE_KEY', 'Avatar storage key is outside the authenticated profile namespace.');
      const replace = dependencies.replaceStorageKey ?? replaceUserProfileStorageKey;
      const replacement = await replace(userKey, input.storageKey, now().toISOString());
      if (!replacement) throw new AccountProfileError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      return {
        profile: projectProfile(replacement),
        previousStorageKey: replacement.previousStorageKey,
      };
    },
  };
}

export const accountProfileService = createAccountProfileService();
