import { migrateLegacySchema } from '../arango-migrate';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const legacySchemaMigration: GraphMigration = {
  id: '0001-legacy-schema',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url), new URL('../arango-migrate.ts', import.meta.url)]),
  // The original migration queried a retired collection on fresh databases.
  compatibleChecksums: ['832bd0b63d38615d7ab46a47a7c0098c733b67ae7e8b045cea6bf826f03beb2c'],
  up: migrateLegacySchema,
};
