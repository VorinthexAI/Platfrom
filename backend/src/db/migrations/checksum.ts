import { createHash } from 'node:crypto';

export async function checksumMigrationFiles(files: readonly URL[]) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(new Uint8Array(await Bun.file(file).arrayBuffer()));
  return hash.digest('hex');
}
