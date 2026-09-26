import { spawn } from 'node:child_process';

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitFor(label: string, probe: () => Promise<void>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await probe();
      return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${label} did not become ready`, { cause: lastError });
}

async function waitForHttp(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
}

await run('docker', ['compose', 'up', '-d', '--wait', 'arangodb', 'redis', 'localstack', 'mailpit']);
await waitFor('LocalStack S3', () => waitForHttp('http://127.0.0.1:4566/vorinthex-dev', { method: 'HEAD' }));
await run('bun', ['run', 'dev']);
