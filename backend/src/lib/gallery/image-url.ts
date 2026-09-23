import { signedMediaDownloadUrl } from '@/lib/media-delivery';

export function signedImageUrl(storageKey: string) {
  return signedMediaDownloadUrl(storageKey);
}
