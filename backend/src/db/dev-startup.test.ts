import { expect, test } from 'bun:test';

const [packageJson, compose, deployCompose] = await Promise.all([
  Bun.file(new URL('../../package.json', import.meta.url)).json() as Promise<{ scripts: Record<string, string> }>,
  Bun.file(new URL('../../docker-compose.yml', import.meta.url)).text(),
  Bun.file(new URL('../../deploy/docker-compose.dev.yml', import.meta.url)).text(),
]);

test('migrates before every local API server entry point', () => {
  for (const script of ['start:server', 'start:app']) {
    const command = packageJson.scripts[script] ?? '';
    expect(command.indexOf('src/db/arango-migrate.ts')).toBeGreaterThan(-1);
    expect(command.indexOf('src/db/arango-migrate.ts')).toBeLessThan(command.indexOf('src/api/index.ts'));
  }
  for (const source of [compose, deployCompose]) {
    expect(source).toContain('bun run src/db/arango-migrate.ts && exec bun run --hot src/api/index.ts');
  }
});
