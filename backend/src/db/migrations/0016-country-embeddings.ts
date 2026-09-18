import type { Database } from 'arangojs';
import { seedCountryCatalog } from '@/lib/travel/seed-countries';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function seedCountryEmbeddings(database: Database) {
  await seedCountryCatalog(database);
}

export const seedCountryEmbeddingsMigration: GraphMigration = {
  id: '0016-country-embeddings',
  checksum: () => checksumMigrationFiles([
    new URL(import.meta.url),
    new URL('../../lib/travel/seed-countries.ts', import.meta.url),
    new URL('../../lib/travel/country-catalog.ts', import.meta.url),
  ]),
  up: seedCountryEmbeddings,
};
