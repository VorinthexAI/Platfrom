import { signedMediaDownloadUrl } from '@/lib/media-delivery';

export function signedAppLogoUrl(storageKey: string) {
  return signedMediaDownloadUrl(storageKey);
}
