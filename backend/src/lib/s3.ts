import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

export function resolveS3ClientConfig(env: NodeJS.ProcessEnv = process.env): S3ClientConfig {
  const endpoint = env.S3_ENDPOINT_URL ?? env.AWS_ENDPOINT_URL;
  const accessKeyId = env.S3_AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? env.BEDROCK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? env.BEDROCK_AWS_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_AWS_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN;
  return {
    region: env.S3_REGION ?? env.AWS_REGION ?? env.BEDROCK_REGION ?? 'eu-north-1',
    endpoint,
    forcePathStyle: Boolean(endpoint),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: accessKeyId && secretAccessKey
      ? {
          accessKeyId,
          secretAccessKey,
          sessionToken,
        }
      : undefined,
  };
}

export const s3 = new S3Client(resolveS3ClientConfig());

export function resolvePublicS3ClientConfig(env: NodeJS.ProcessEnv = process.env) {
  return resolveS3ClientConfig({
    ...env,
    ...(env.S3_PUBLIC_ENDPOINT_URL ? { S3_ENDPOINT_URL: env.S3_PUBLIC_ENDPOINT_URL } : {}),
  });
}

export function createPublicS3Client(env: NodeJS.ProcessEnv = process.env) {
  return new S3Client(resolvePublicS3ClientConfig(env));
}

export const S3_BUCKET = process.env.S3_BUCKET ?? 'vorinthex-dev';
