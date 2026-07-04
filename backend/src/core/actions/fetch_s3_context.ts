import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { s3, S3_BUCKET } from '@/lib/s3';

export const fetchS3ContextInputSchema = z.object({
  path: z.string().optional(),
  prefix: z.string().optional(),
});

export async function fetch_s3_context(input: z.infer<typeof fetchS3ContextInputSchema>) {
  const parsed = fetchS3ContextInputSchema.parse(input);
  const keys: string[] = parsed.path
    ? [parsed.path]
    : (await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: parsed.prefix }))).Contents?.flatMap((item) => item.Key ? [item.Key] : []) ?? [];
  const files: Record<string, string> = {};
  for (const key of keys) {
    const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    files[key] = await object.Body!.transformToString();
  }
  return files;
}
