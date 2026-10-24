import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function up(database: Database) {
  const nodes = database.collection('inventoryNodes');
  if (await nodes.exists()) {
    await database.query(`
      FOR node IN inventoryNodes
        FILTER IS_STRING(node.storageKey) && LENGTH(TRIM(node.storageKey)) > 0
        UPSERT { storageKey: node.storageKey }
        INSERT { storageKey: node.storageKey, createdAt: @now, status: "pending" }
        UPDATE {}
        IN storageDeletionJobs
    `, { now: new Date().toISOString() });
  }
  for (const name of ['inventoryEdges', 'inventoryNodes']) {
    const collection = database.collection(name);
    if (await collection.exists()) await collection.drop();
  }
}

export const dropInventoryGraphMigration: GraphMigration = {
  id: '0012-drop-inventory-graph',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up,
};
