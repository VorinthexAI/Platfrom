import type { Context } from 'hono';
import { completeProfileAvatarUpload, normalizeProfileAvatarUploadError, profileAvatarCompleteInputSchema, profileAvatarReserveInputSchema, reserveProfileAvatarUpload } from '@/lib/account-profile/avatar-upload';
import { signProfileAvatarUrl, trySignProfileAvatarUrl } from '@/lib/account-profile/avatar-url';
import { accountProfileService, normalizeAccountProfileError, profileNameUpdateInputSchema, type AccountProfileService } from '@/lib/account-profile/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

async function userKey(c: Context) {
  const identity = await getAuthIdentity(c);
  return identity?.identityType === 'user' ? identity.key : null;
}

async function profileResponse(profile: { name: string | null; profileStorageKey: string | null }, signer: typeof signProfileAvatarUrl = signProfileAvatarUrl) {
  return { name: profile.name, avatarUrl: profile.profileStorageKey ? await trySignProfileAvatarUrl(profile.profileStorageKey, signer) : null };
}

function failure(c: Context, error: unknown, avatar = false) {
  const normalized = avatar ? normalizeProfileAvatarUploadError(error) : normalizeAccountProfileError(error);
  return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status);
}

export function createUpdateAccountProfileHandler(dependencies: {
  getIdentity?: typeof getAuthIdentity;
  service?: Pick<AccountProfileService, 'updateName'>;
  signAvatar?: typeof signProfileAvatarUrl;
} = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    const authenticatedUserKey = identity?.identityType === 'user' ? identity.key : null;
    if (!authenticatedUserKey) return c.json({ success: false, error: 'user authentication required' }, 401);
    try {
      const result = await (dependencies.service ?? accountProfileService).updateName(await parseJson(c, profileNameUpdateInputSchema), authenticatedUserKey);
      const avatarUrl = result.profile.profileStorageKey ? await trySignProfileAvatarUrl(result.profile.profileStorageKey, dependencies.signAvatar) : null;
      return c.json({ success: true, data: { profile: { name: result.profile.name, avatarUrl } } });
    } catch (error) { return failure(c, error); }
  };
}

export const updateAccountProfile = createUpdateAccountProfileHandler();

export async function presignAccountAvatar(c: Context) {
  const authenticatedUserKey = await userKey(c);
  if (!authenticatedUserKey) return c.json({ success: false, error: 'user authentication required' }, 401);
  try { return c.json({ success: true, data: await reserveProfileAvatarUpload(await parseJson(c, profileAvatarReserveInputSchema), authenticatedUserKey) }, 201); }
  catch (error) { return failure(c, error, true); }
}

export function createCompleteAccountAvatarHandler(dependencies: {
  getIdentity?: typeof getAuthIdentity;
  complete?: typeof completeProfileAvatarUpload;
  signAvatar?: typeof signProfileAvatarUrl;
} = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    const authenticatedUserKey = identity?.identityType === 'user' ? identity.key : null;
    if (!authenticatedUserKey) return c.json({ success: false, error: 'user authentication required' }, 401);
    try {
      const result = await (dependencies.complete ?? completeProfileAvatarUpload)(await parseJson(c, profileAvatarCompleteInputSchema), authenticatedUserKey);
      return c.json({ success: true, data: { profile: await profileResponse(result.profile, dependencies.signAvatar), avatar: result.avatar } });
    } catch (error) { return failure(c, error, true); }
  };
}

export const completeAccountAvatar = createCompleteAccountAvatarHandler();
