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

export const defaultBookService = createBookService({
  repository,
  generator: createBookRuntime({ repository }),
  enqueue: enqueueBookGeneration,
  removeJob: removeBookGenerationJob,
  signUrl: (key) => signObject(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 15 * 60 }),
});
