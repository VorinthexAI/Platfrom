const required = ['ARANGO_URL', 'ARANGO_USERNAME', 'ARANGO_ROOT_PASSWORD'] as const;
const missing = required.filter((name) => process.env[name] === undefined || process.env[name] === '');

if (missing.length) {
  console.error(`Live email attachment tests require ${missing.join(', ')}. Example: ARANGO_URL=http://127.0.0.1:8529 ARANGO_USERNAME=root ARANGO_ROOT_PASSWORD=vorinthex bun run test:email-attachments:live`);
  process.exit(1);
}

const child = Bun.spawn(['bun', 'test', 'src/lib/email-inbox/attachment-ingestion.arango.test.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
import { fileURLToPath } from 'node:url';
