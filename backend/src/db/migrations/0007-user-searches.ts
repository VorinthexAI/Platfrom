import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function ensureUserSearches(database: Database) {
  const searches = database.collection('userSearches');
  if (!await searches.exists()) await searches.create();
  await searches.ensureIndex({ type: 'persistent', fields: ['userKey', 'normalizedQuery'], unique: true });
  await searches.ensureIndex({ type: 'persistent', fields: ['userKey', 'searchedAt'] });
}

export const userSearchesMigration: GraphMigration = {
  id: '0007-user-searches',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: ensureUserSearches,
};
