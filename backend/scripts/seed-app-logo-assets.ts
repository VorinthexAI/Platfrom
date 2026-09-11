import { resolve } from 'node:path';
import { seedAppLogoAssets, seedInitialAudiobookAssets } from '@/lib/apps/logo-assets';
import { s3, S3_BUCKET } from '@/lib/s3';

export function assertAppLogoSeedEnvironment(mode: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (mode === '--local') {
    const endpoint = env.S3_ENDPOINT_URL ?? env.AWS_ENDPOINT_URL;
    if (!endpoint || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(endpoint)) {
      throw new Error('Local app logo seeding requires a localhost LocalStack endpoint.');
    }
    if (env.S3_BUCKET !== 'vorinthex-dev') throw new Error('Local app logo seeding requires S3_BUCKET=vorinthex-dev.');
    return;
  }
  if (mode === '--production-ci') {
    if (env.S3_ENDPOINT_URL || env.AWS_ENDPOINT_URL) throw new Error('Production app logo seeding forbids custom S3 endpoints.');
    if (!env.S3_BUCKET || env.S3_BUCKET === 'vorinthex-dev') throw new Error('Production app logo seeding requires the production S3 bucket.');
    if (env.CI !== 'true') throw new Error('Production app logo seeding may only run in CI.');
    return;
  }
  throw new Error('Specify exactly one app logo seed mode: --local or --production-ci.');
}

if (import.meta.main) {
  assertAppLogoSeedEnvironment(process.argv[2]);
  const options = {
    client: s3,
    bucket: S3_BUCKET,
    repositoryRoot: resolve(import.meta.dir, '../..'),
    forceUpload: process.argv[2] === '--production-ci',
  };
  console.table(await seedAppLogoAssets(options));
  console.table(await seedInitialAudiobookAssets(options));
}
