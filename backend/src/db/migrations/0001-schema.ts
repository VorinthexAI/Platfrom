import { migrateSchema } from '../arango-migrate';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const schemaMigration: GraphMigration = {
  id: '0001-schema',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url), new URL('../arango-migrate.ts', import.meta.url)]),
  up: migrateSchema,
};
