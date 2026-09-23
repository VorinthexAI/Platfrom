import { createHash, createPrivateKey, sign } from 'node:crypto';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPublicS3Client, S3_BUCKET } from './s3';

const TTL_SECONDS = 15 * 60;
export const AUDIO_URL_TTL_SECONDS = 2 * 60 * 60;
const publicS3 = createPublicS3Client();
const cloudfront = new CloudFrontClient({ region: 'us-east-1' });
const signS3Url = getSignedUrl as unknown as (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;
let cachedKey: { pem: string; key: ReturnType<typeof createPrivateKey> } | undefined;

export function signMediaDownloadUrl(storageKey: string, settings: {
  domain: string; keyPairId: string; privateKey: string; now?: () => number; ttlSeconds?: number;
}): string {
  if (!storageKey || storageKey.startsWith('/') || storageKey.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid storage key');
  const { domain, keyPairId, privateKey } = settings;
  if (!/^[a-z0-9.-]+$/.test(domain) || !/^[A-Z0-9]+$/.test(keyPairId)) throw new Error('Invalid media delivery configuration');
  const pem = privateKey.replaceAll('\\n', '\n');
  if (cachedKey?.pem !== pem) cachedKey = { pem, key: createPrivateKey(pem) };
  const path = storageKey.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  const url = `https://${domain}/${path}`;
  const expires = Math.floor((settings.now?.() ?? Date.now()) / 1000) + (settings.ttlSeconds ?? TTL_SECONDS);
  const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expires } } }] });
  const signature = sign('RSA-SHA256', Buffer.from(policy), cachedKey.key).toString('base64').replaceAll('+', '-').replaceAll('=', '_').replaceAll('/', '~');
  return `${url}?Expires=${expires}&Signature=${signature}&Key-Pair-Id=${keyPairId}&Hash-Algorithm=SHA256`;
}

export function signedMediaDownloadUrl(storageKey: string, ttlSeconds = TTL_SECONDS): Promise<string> {
  const domain = process.env.MEDIA_CDN_DOMAIN;
  const keyPairId = process.env.MEDIA_CDN_KEY_PAIR_ID;
  const privateKey = process.env.MEDIA_CDN_PRIVATE_KEY;
  if (domain && keyPairId && privateKey) return Promise.resolve(signMediaDownloadUrl(storageKey, { domain, keyPairId, privateKey, ttlSeconds }));
  if (process.env.NODE_ENV === 'production') throw new Error('Private media delivery is not configured');
  return signS3Url(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }), { expiresIn: ttlSeconds });
}

export async function invalidateMediaDownload(storageKey: string) {
  const distributionId = process.env.MEDIA_CDN_DISTRIBUTION_ID;
  if (storageKey.startsWith('pending/') && !storageKey.startsWith('pending/profile-avatars/')) return;
  if (!distributionId) {
    if (process.env.NODE_ENV === 'production' && process.env.MEDIA_CDN_DOMAIN) throw new Error('Private media invalidation is not configured');
    return;
  }
  const path = `/${storageKey.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`;
  await cloudfront.send(new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `object-deleted-${createHash('sha256').update(storageKey).digest('hex')}-${Date.now()}`,
      Paths: { Quantity: 1, Items: [path] },
    },
  }));
}
