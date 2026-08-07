import { expect, test } from 'bun:test';

test('deploys a compatible API before migration, Qwen seed cutover, and backfill', async () => {
  const workflow = await Bun.file(new URL('../../.github/workflows/deploy.yml', import.meta.url)).text();
  const early = workflow.indexOf('early-deploy:');
  const database = workflow.indexOf('backend-db:');
  expect(early).toBeGreaterThan(-1);
  expect(database).toBeGreaterThan(-1);
  const databaseJob = workflow.slice(database, workflow.indexOf('\n  backend-migrate:', database));
  expect(databaseJob).toContain('timeout-minutes: 60');
  expect(databaseJob).toContain('needs: [changes, backend-secrets, early-deploy]');
  expect(databaseJob).toContain("needs.early-deploy.result == 'success'");
  expect(databaseJob.indexOf('db:migrate:ci')).toBeLessThan(databaseJob.indexOf('seed.ts'));
  expect(databaseJob.indexOf('seed.ts')).toBeLessThan(databaseJob.indexOf('db:backfill-semantic-embeddings:ci'));
  const earlyJob = workflow.slice(early, workflow.indexOf('\n  # LATER REFERENCE ONLY', early));
  expect(earlyJob).not.toContain('backend-migrate');
  expect(earlyJob).toContain('needs: [changes, deploy-web, backend-image, backend-secrets]');
  const ecsJob = workflow.slice(workflow.indexOf('backend-deploy:'), workflow.indexOf('\n  # Optional render worker'));
  expect(ecsJob).toContain('if: false # LATER: enable when ECS becomes the production runtime.');
});
