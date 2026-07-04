import { PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { s3, S3_BUCKET } from '@/lib/s3';

export const writeS3ContextInputSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export async function write_s3_context(input: z.infer<typeof writeS3ContextInputSchema>) {
  const parsed = writeS3ContextInputSchema.parse(input);
  const key = `${parsed.path.replace(/\/$/, '')}/${new Date().toISOString()}.md`;
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: parsed.content, ContentType: 'text/markdown' }));
  return { key };
}

