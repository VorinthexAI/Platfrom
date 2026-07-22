import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const defaults: Record<string, string> = {
  ARCHIVE_E2E: 'true',
  ARANGO_URL: 'http://127.0.0.1:8529',
  ARANGO_DATABASE: 'vorinthex_archive_e2e',
  ARANGO_USERNAME: 'root',
  ARANGO_ROOT_PASSWORD: 'vorinthex',
  REDIS_URL: 'redis://127.0.0.1:6380',
  AWS_REGION: 'eu-north-1',
  AWS_ENDPOINT_URL: 'http://127.0.0.1:4566',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  S3_BUCKET: 'vorinthex-dev',
  EMBEDDING_DIMENSIONS: '1024',
  ORCHESTRATION_CREDENTIALS_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const suppliedDatabase = Boolean(process.env.ARANGO_DATABASE);
const env = { ...process.env } as Record<string, string>;
for (const [key, value] of Object.entries(defaults)) env[key] ??= value;

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}

async function waitFor(label: string, probe: () => Promise<void>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { await probe(); return; } catch (error) { lastError = error; }
    await Bun.sleep(500);
  }
  throw new Error(`${label} did not become ready`, { cause: lastError });
}

async function waitForHttp(url: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
}

async function waitForTcp(url: string) {
  const target = new URL(url);
  await new Promise<void>((resolve, reject) => {
    const socket = connect(Number(target.port || 6379), target.hostname);
    socket.setTimeout(2_000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
    socket.once('error', reject);
  });
}

await run('docker', ['compose', 'up', '-d', 'arangodb', 'redis', 'localstack']);
const arangoHeaders = { Authorization: `Basic ${Buffer.from(`${env.ARANGO_USERNAME}:${env.ARANGO_ROOT_PASSWORD}`).toString('base64')}` };
await Promise.all([
  waitFor('ArangoDB', () => waitForHttp(`${env.ARANGO_URL}/_api/version`, arangoHeaders)),
  waitFor('Redis', () => waitForTcp(env.REDIS_URL)),
  waitFor('LocalStack', () => waitForHttp(`${env.AWS_ENDPOINT_URL}/_localstack/health`)),
]);

if (!suppliedDatabase && env.ARANGO_DATABASE === defaults.ARANGO_DATABASE) {
  await fetch(`${env.ARANGO_URL}/_api/database/${encodeURIComponent(env.ARANGO_DATABASE)}`, { method: 'DELETE', headers: arangoHeaders });
}
await run('bun', ['run', 'src/db/arango-migrate.ts']);
await run('bun', ['test', 'src/lib/ai/tools/document-tools.e2e.test.ts']);
