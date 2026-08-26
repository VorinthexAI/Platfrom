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
  const seed = databaseJob.indexOf('- name: Seed deterministic/runtime catalog');
  const backfill = databaseJob.indexOf('- name: Backfill semantic embeddings');
  expect(databaseJob).not.toContain('- name: Apply graph migrations');
  expect(seed).toBeGreaterThan(-1);
  expect(backfill).toBeGreaterThan(seed);
  expect(databaseJob).toContain('run: bun run --cwd backend db:seed:ci');
  expect(databaseJob).toContain('run: bun run --cwd backend db:backfill-semantic-embeddings:ci');
  const migration = workflow.indexOf('\n  backend-migrate:');
  const migrationJob = workflow.slice(migration, workflow.indexOf('\n  seed-db-secrets:', migration));
  expect(migrationJob).toContain('needs: [changes, backend-image, backend-secrets]');
  expect(migrationJob).toContain('always()');
  expect(migrationJob).not.toContain('needs.early-deploy.result');
  expect(migrationJob).toContain('- name: Apply graph migrations');
  expect(migrationJob).toContain('run: bun run --cwd backend db:migrate:ci');
  const earlyJob = workflow.slice(early, workflow.indexOf('\n  # LATER REFERENCE ONLY', early));
  expect(earlyJob).toContain('needs: [changes, deploy-web, backend-image, backend-secrets, backend-migrate]');
  expect(earlyJob).toContain("needs.backend-migrate.result == 'success'");
  expect(workflow).not.toContain('document-worker-deploy:');
  expect(workflow).not.toContain('Roll warm document worker');
  const ecsJob = workflow.slice(workflow.indexOf('backend-deploy:'), workflow.indexOf('\n  # Optional render worker'));
  expect(ecsJob).toContain('if: false # LATER: enable when ECS becomes the production runtime.');
});

test('CI database scripts do not generate a development env file', async () => {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json();

  expect(packageJson.scripts['db:migrate:ci']).toBe('bun run src/db/arango-migrate.ts');
  expect(packageJson.scripts['db:seed:ci']).toBe('bun run src/lib/db/seed.ts');
  expect(packageJson.scripts['db:backfill-semantic-embeddings:ci']).toBe(
    'bun run scripts/backfill-semantic-embeddings.ts',
  );
});
