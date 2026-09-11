import { expect, test } from 'bun:test';

test('migrates before activating backend code and running data changes', async () => {
  const workflow = await Bun.file(new URL('../../.github/workflows/deploy.yml', import.meta.url)).text();
  const early = workflow.indexOf('early-deploy:');
  const database = workflow.indexOf('backend-db:');
  expect(early).toBeGreaterThan(-1);
  expect(database).toBeGreaterThan(-1);
  const databaseJob = workflow.slice(database, workflow.indexOf('\n  backend-migrate:', database));
  expect(databaseJob).toContain('timeout-minutes: 60');
  expect(databaseJob).toContain('needs: [changes, backend-secrets, backend-migrate]');
  expect(databaseJob).toContain("needs.backend-migrate.result == 'success'");
  const seed = databaseJob.indexOf('- name: Seed deterministic application data');
  const catalogSync = databaseJob.indexOf('- name: Sync Polar product catalog');
  const backfill = databaseJob.indexOf('- name: Backfill semantic embeddings');
  expect(databaseJob).not.toContain('- name: Apply graph migrations');
  expect(seed).toBeGreaterThan(-1);
  expect(catalogSync).toBeGreaterThan(seed);
  expect(backfill).toBeGreaterThan(catalogSync);
  expect(backfill).toBeGreaterThan(seed);
  expect(databaseJob).toContain('run: bun run --cwd backend db:seed:ci');
  expect(databaseJob).toContain('case "$polar_env" in sandbox|production)');
  expect(databaseJob).not.toContain('POLAR_ENV must be production for a production deployment');
  expect(databaseJob).toContain('run: bun run --cwd backend db:backfill-semantic-embeddings:ci');
  expect(databaseJob).toContain("S3_BUCKET=$(jq -re '.vars.PROD_S3_BUCKET_NAME' .github/environments.json)");
  expect(databaseJob).not.toContain('BEDROCK_AWS_ACCESS_KEY_ID');
  expect(databaseJob).not.toContain('BEDROCK_AWS_SECRET_ACCESS_KEY');
  expect(databaseJob).toContain('OPENROUTER_API_KEY');
  const migration = workflow.indexOf('\n  backend-migrate:');
  const migrationJob = workflow.slice(migration, workflow.indexOf('\n  seed-db-secrets:', migration));
  expect(migrationJob).toContain('needs: [changes, backend-image, backend-secrets, backend-system-assets]');
  expect(migrationJob).toContain("needs.backend-system-assets.result == 'success'");
  expect(migrationJob).toContain('always()');
  expect(migrationJob).not.toContain('needs.early-deploy.result');
  expect(migrationJob).toContain('- name: Apply graph migrations');
  expect(migrationJob).toContain('run: bun run --cwd backend db:migrate:ci');
  expect(migrationJob).toContain("S3_BUCKET=\"$(jq -re '.vars.PROD_S3_BUCKET_NAME' .github/environments.json)\"");
  const seedSecrets = workflow.indexOf('\n  seed-db-secrets:');
  const seedSecretsJob = workflow.slice(seedSecrets, workflow.indexOf('\n  backend-deploy:', seedSecrets));
  expect(seedSecretsJob).toContain('OPENROUTER_API_KEY');
  expect(seedSecretsJob).toContain('seeded roster embeddings cannot run');
  const earlyJob = workflow.slice(early, workflow.indexOf('\n  # LATER REFERENCE ONLY', early));
  expect(earlyJob).toContain('needs: [changes, deploy-web, backend-image, backend-secrets, backend-migrate, backend-db]');
  expect(earlyJob).toContain("needs.backend-migrate.result == 'success'");
  expect(earlyJob).toContain("needs.backend-db.result == 'success'");
  expect(workflow).not.toContain('document-worker-deploy:');
  expect(workflow).not.toContain('Roll warm document worker');
  const ecsJob = workflow.slice(workflow.indexOf('backend-deploy:'), workflow.indexOf('\n  # Optional render worker'));
  expect(ecsJob).toContain('needs: [changes, backend-image, backend-db]');
  expect(ecsJob).toContain('if: false # LATER: enable when ECS becomes the production runtime.');
  const standaloneJob = workflow.slice(workflow.indexOf('\n  early-infra-standalone-deploy:'), workflow.indexOf('\n  deploy-summary:'));
  expect(standaloneJob).toContain('needs: [early-infra-standalone-build, backend-db]');
});

test('uploads canonical app logos before graph migration and deployment', async () => {
  const workflow = await Bun.file(new URL('../../.github/workflows/deploy.yml', import.meta.url)).text();
  const assets = workflow.indexOf('\n  backend-system-assets:');
  const migration = workflow.indexOf('\n  backend-migrate:');
  const deployment = workflow.indexOf('\n  early-deploy:');
  expect(assets).toBeGreaterThan(-1);
  expect(assets).toBeLessThan(migration);
  expect(migration).toBeLessThan(deployment);
  const assetJob = workflow.slice(assets, migration);
  expect(assetJob).toContain(".vars.PROD_S3_BUCKET_NAME");
  expect(assetJob).toContain('aws-actions/configure-aws-credentials@v4');
  expect(assetJob).toContain('bun run --cwd backend assets:seed:ci');
  const deployPolicy = await Bun.file(new URL('../../terraform/environments/production/deploy_iam.tf', import.meta.url)).text();
  expect(deployPolicy).toMatch(/Action\s+= \["s3:GetObject", "s3:PutObject"\]/);
  expect(deployPolicy).toContain('/apps/logos/v1/*');
  expect(deployPolicy).toContain('/system/initial-audiobook/v1/*');
  expect(deployPolicy).toContain('Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]');
  expect(deployPolicy).toContain('/managed/scope-directory/v1/*');
  expect(workflow).toContain('web/app/public/logos/*) web=true; backend=true');
  const migrationSource = await Bun.file(new URL('./db/arango-migrate.ts', import.meta.url)).text();
  expect(migrationSource.indexOf('const productScopeKeysBySlug')).toBeLessThan(migrationSource.indexOf('await reconcileManagedScopeDirectory'));
});

test('CI database scripts do not generate a development env file', async () => {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json();

  expect(packageJson.scripts['db:migrate:ci']).toBe('bun run src/db/migration-runner.ts');
  expect(packageJson.scripts['db:seed:ci']).toBe('bun run src/lib/db/seed.ts');
  expect(packageJson.scripts['assets:seed:ci']).toBe('bun run scripts/seed-app-logo-assets.ts --production-ci');
  expect(packageJson.scripts['db:backfill-semantic-embeddings:ci']).toBe(
    'bun run scripts/backfill-semantic-embeddings.ts',
  );
});

test('normal local server scripts seed app logos before migration', async () => {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json();

  for (const name of ['dev', 'start:server', 'start:app']) {
    const script = packageJson.scripts[name] as string;
    expect(script.indexOf('load-local-env')).toBeLessThan(script.indexOf('seed-app-logo-assets.ts --local'));
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.indexOf('migration-runner.ts'));
    expect(script.indexOf('migration-runner.ts')).toBeLessThan(script.indexOf('src/api/index.ts'));
  }

  for (const name of ['db:migrate', 'db:migrate:dev']) {
    const script = packageJson.scripts[name] as string;
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.indexOf('migration-runner.ts'));
  }

  for (const name of ['seed.ts', 'db:seed']) {
    const script = packageJson.scripts[name] as string;
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeGreaterThan(-1);
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.lastIndexOf('src/'));
  }
});
