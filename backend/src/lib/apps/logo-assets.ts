import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { APP_LOGO_MANIFEST } from './logo-manifest';

export const APP_LOGO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type LogoAssetClient = Pick<S3Client, 'send'>;

function isMissingObject(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NotFound' || value.name === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404;
}

export async function seedAppLogoAssets({
  client,
  bucket,
  repositoryRoot,
}: {
  client: LogoAssetClient;
  bucket: string;
  repositoryRoot: string;
}) {
  if (!bucket.trim()) throw new Error('App logo asset seeding requires a non-empty S3 bucket.');
  const results: Array<{ slug: string; storageKey: string; status: 'uploaded' | 'unchanged'; checksum: string }> = [];

  for (const [slug, asset] of Object.entries(APP_LOGO_MANIFEST)) {
    const body = new Uint8Array(await Bun.file(resolve(repositoryRoot, asset.sourcePath)).arrayBuffer());
    if (body.byteLength === 0) throw new Error(`App logo source is empty: ${asset.sourcePath}`);
    const checksum = createHash('sha256').update(body).digest('hex');
    let unchanged = false;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.storageKey }));
      unchanged = head.Metadata?.sha256 === checksum
        && head.ContentType === 'image/png'
        && head.CacheControl === APP_LOGO_CACHE_CONTROL;
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }

    if (!unchanged) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: asset.storageKey,
        Body: body,
        ContentType: 'image/png',
        CacheControl: APP_LOGO_CACHE_CONTROL,
        Metadata: { sha256: checksum },
        ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
      }));
    }
    results.push({ slug, storageKey: asset.storageKey, status: unchanged ? 'unchanged' : 'uploaded', checksum });
  }

  return results;
}
