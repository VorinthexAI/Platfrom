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

await run('docker', ['compose', 'up', '-d', 'arangodb', 'redis', 'localstack', 'mailpit']);
await run('bun', ['run', 'db:migrate:dev']);
await run('bun', ['run', 'dev']);
