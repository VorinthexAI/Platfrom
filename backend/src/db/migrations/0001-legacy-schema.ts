import { migrateLegacySchema } from '../arango-migrate';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const legacySchemaMigration: GraphMigration = {
  id: '0001-legacy-schema',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url), new URL('../arango-migrate.ts', import.meta.url)]),
  up: migrateLegacySchema,
};
