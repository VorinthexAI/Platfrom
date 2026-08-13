import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPublicS3Client, S3_BUCKET } from '@/lib/s3';

const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

export function signedImageUrl(storageKey: string) {
  return signUrl(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }), { expiresIn: 15 * 60 });
}
