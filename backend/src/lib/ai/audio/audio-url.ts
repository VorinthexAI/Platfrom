import { AUDIO_URL_TTL_SECONDS, signedMediaDownloadUrl } from '@/lib/media-delivery';

export function signedAudioUrl(storageKey: string) {
  return signedMediaDownloadUrl(storageKey, AUDIO_URL_TTL_SECONDS);
}
