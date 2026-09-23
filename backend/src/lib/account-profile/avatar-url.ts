import { signedMediaDownloadUrl } from '@/lib/media-delivery';

export function signProfileAvatarUrl(storageKey: string) {
  return signedMediaDownloadUrl(storageKey);
}

export async function trySignProfileAvatarUrl(storageKey: string, signer: typeof signProfileAvatarUrl = signProfileAvatarUrl) {
  try {
    return await signer(storageKey);
  } catch (error) {
    console.warn('profile avatar URL signing failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}
