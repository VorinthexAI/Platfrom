import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function removeUniqueSparkEventIndex(database: Database) {
  const collection = database.collection('sparkTransactions');
  for (const index of await collection.indexes()) {
    if (index.unique === true && index.fields?.length === 1 && index.fields[0] === 'eventKey') {
      await collection.dropIndex(index.id);
    }
  }
}

export const sparkEventIndexMigration: GraphMigration = {
  id: '0002-spark-event-index',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: removeUniqueSparkEventIndex,
};
