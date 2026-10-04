import { z } from 'zod';
import { getUserByEmail } from '@/lib/db/users.node';

export function requireLocalFilesEnvironment() {
  const arango = new URL(process.env.ARANGO_URL ?? 'http://127.0.0.1:8529');
  const storageEndpoint = process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL;
  const storage = storageEndpoint ? new URL(storageEndpoint) : null;
  const redis = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  const jobRedis = new URL(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
  const local = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (process.env.NODE_ENV === 'production' || !local(arango) || !storage || !local(storage) || !local(redis) || !local(jobRedis) || process.env.S3_BUCKET !== 'vorinthex-dev' || (process.env.ARANGO_DATABASE ?? 'vorinthex') !== 'vorinthex') {
    throw new Error('Dev file commands require local ArangoDB, Redis, an explicit local S3 endpoint, and the vorinthex-dev bucket.');
  }
}

export async function targetDevUser(args: string[]) {
  const emailArg = args.find((arg) => arg.startsWith('--email='));
  if (!emailArg || args.length !== 1) throw new Error('Provide exactly one --email=person@example.com argument.');
  const email = z.string().trim().toLowerCase().email().parse(emailArg.slice('--email='.length));
  requireLocalFilesEnvironment();
  const user = await getUserByEmail(email);
  if (!user || user.deletionRequestedAt) throw new Error(`No active dev account found for ${email}.`);
  return user;
}
