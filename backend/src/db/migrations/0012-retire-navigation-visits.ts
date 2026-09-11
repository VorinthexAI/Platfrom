import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function retireNavigationVisits(database: Database) {
  const collection = database.collection('navigationVisits');
  if (await collection.exists()) await collection.drop();
}

export const retireNavigationVisitsMigration: GraphMigration = {
  id: '0012-retire-navigation-visits',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: retireNavigationVisits,
};
