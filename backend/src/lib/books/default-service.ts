import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPublicS3Client, S3_BUCKET } from '@/lib/s3';
import { createBookRepository } from './repository';
import { createBookRuntime } from './runtime';
import { createBookService } from './service';
import { enqueueBookGeneration, removeBookGenerationJob } from './generation-queue';

const repository = createBookRepository();
const publicS3 = createPublicS3Client();
const signObject = getSignedUrl as unknown as (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

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

const signBookUrl = createCachedUrlSigner((key) => signObject(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 15 * 60 }));
const signPublicBookUrl = (key: string) => signObject(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 5 * 60 });

export const defaultBookService = createBookService({
  repository,
  generator: createBookRuntime({ repository }),
  enqueue: enqueueBookGeneration,
  removeJob: removeBookGenerationJob,
  signUrl: signBookUrl,
  publicSignUrl: signPublicBookUrl,
});
