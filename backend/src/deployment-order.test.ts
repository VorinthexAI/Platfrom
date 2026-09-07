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
  const backfill = databaseJob.indexOf('- name: Backfill semantic embeddings');
  expect(databaseJob).not.toContain('- name: Apply graph migrations');
  expect(seed).toBeGreaterThan(-1);
  expect(backfill).toBeGreaterThan(seed);
  expect(databaseJob).toContain('run: bun run --cwd backend db:seed:ci');
  expect(databaseJob).toContain('run: bun run --cwd backend db:backfill-semantic-embeddings:ci');
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
  const seedSecrets = workflow.indexOf('\n  seed-db-secrets:');
  const seedSecretsJob = workflow.slice(seedSecrets, workflow.indexOf('\n  backend-deploy:', seedSecrets));
  expect(seedSecretsJob).toContain('OPENROUTER_API_KEY');
  expect(seedSecretsJob).toContain('seeded roster embeddings cannot run');
  const earlyJob = workflow.slice(early, workflow.indexOf('\n  # LATER REFERENCE ONLY', early));
  expect(earlyJob).toContain('needs: [changes, deploy-web, backend-image, backend-secrets, backend-migrate]');
  expect(earlyJob).toContain("needs.backend-migrate.result == 'success'");
  expect(workflow).not.toContain('document-worker-deploy:');
  expect(workflow).not.toContain('Roll warm document worker');
  const ecsJob = workflow.slice(workflow.indexOf('backend-deploy:'), workflow.indexOf('\n  # Optional render worker'));
  expect(ecsJob).toContain('if: false # LATER: enable when ECS becomes the production runtime.');
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
  expect(workflow).toContain('web/app/public/logos/*) web=true; backend=true');
  const migrationSource = await Bun.file(new URL('./db/arango-migrate.ts', import.meta.url)).text();
  expect(migrationSource.indexOf('const productScopeKeysBySlug')).toBeLessThan(migrationSource.indexOf('await reconcileManagedScopeDirectory'));
});

test('CI database scripts do not generate a development env file', async () => {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json();

  expect(packageJson.scripts['db:migrate:ci']).toBe('bun run src/db/arango-migrate.ts');
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
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.indexOf('arango-migrate.ts'));
    expect(script.indexOf('arango-migrate.ts')).toBeLessThan(script.indexOf('src/api/index.ts'));
  }

  for (const name of ['db:migrate', 'db:migrate:dev']) {
    const script = packageJson.scripts[name] as string;
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.indexOf('arango-migrate.ts'));
  }

  for (const name of ['seed.ts', 'db:seed']) {
    const script = packageJson.scripts[name] as string;
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeGreaterThan(-1);
    expect(script.indexOf('seed-app-logo-assets.ts --local')).toBeLessThan(script.lastIndexOf('src/'));
  }
});
