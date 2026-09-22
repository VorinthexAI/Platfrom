import { expect, test } from 'bun:test';

test('migrates before activating backend code', async () => {
  const workflow = await Bun.file(new URL('../../.github/workflows/deploy.yml', import.meta.url)).text();
  const early = workflow.indexOf('early-deploy:');
  expect(early).toBeGreaterThan(-1);
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
  expect(seedSecretsJob).toContain('needs: [changes, backend-migrate]');
  expect(seedSecretsJob).toContain('OPENROUTER_API_KEY');
  expect(seedSecretsJob).toContain('seeded roster embeddings cannot run');
  const earlyJob = workflow.slice(early, workflow.indexOf('\n  # LATER REFERENCE ONLY', early));
  expect(earlyJob).toContain('needs: [changes, deploy-web, backend-image, backend-secrets, backend-migrate]');
  expect(earlyJob).toContain("needs.backend-migrate.result == 'success'");
  expect(workflow).not.toContain('document-worker-deploy:');
  expect(workflow).not.toContain('Roll warm document worker');
  const ecsJob = workflow.slice(workflow.indexOf('backend-deploy:'), workflow.indexOf('\n  # Optional render worker'));
  expect(ecsJob).toContain('needs: [changes, backend-image]');
  expect(ecsJob).toContain('if: false # LATER: enable when ECS becomes the production runtime.');
  const standaloneJob = workflow.slice(workflow.indexOf('\n  early-infra-standalone-deploy:'), workflow.indexOf('\n  deploy-summary:'));
  expect(standaloneJob).toContain('needs: [early-infra-standalone-build]');
  expect(workflow).toContain('if: false # Catalog sync and embedding backfills are not deployment work.');
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
  expect(packageJson.scripts['db:seed:ci']).toBeUndefined();
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

  expect(packageJson.scripts['seed.ts']).toBeUndefined();
  expect(packageJson.scripts['db:seed']).toBeUndefined();
});
