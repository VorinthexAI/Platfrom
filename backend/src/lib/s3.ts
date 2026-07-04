import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'eu-north-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      }
    : undefined,
});

export const S3_BUCKET = process.env.S3_BUCKET ?? 'vorinthex-dev';

