import { AUDIO_URL_TTL_SECONDS, signedMediaDownloadUrl } from '@/lib/media-delivery';
import { createBookRepository } from './repository';
import { createBookRuntime } from './runtime';
import { createBookService } from './service';

const repository = createBookRepository();

export function createCachedUrlSigner(sign: (key: string) => Promise<string>, options: { cacheMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const cacheMs = options.cacheMs ?? 12 * 60_000;
  const maxEntries = options.maxEntries ?? 1_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; url: Promise<string> }>();
  return (key: string) => {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.url;
    if (cached) cache.delete(key);
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
    const url = sign(key);
    cache.set(key, { expiresAt: now() + cacheMs, url });
    void url.catch(() => { if (cache.get(key)?.url === url) cache.delete(key); });
    return url;
  };
}

const signBookUrl = createCachedUrlSigner((key) => signedMediaDownloadUrl(key, AUDIO_URL_TTL_SECONDS));
export const defaultBookService = createBookService({
  repository,
  generator: createBookRuntime({ repository }),
  signUrl: signBookUrl,
});
