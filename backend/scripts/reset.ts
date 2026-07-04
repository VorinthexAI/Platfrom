import { spawn } from 'node:child_process';

const child = spawn('docker', ['compose', 'down', '-v'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
process.exit(code ?? 1);

