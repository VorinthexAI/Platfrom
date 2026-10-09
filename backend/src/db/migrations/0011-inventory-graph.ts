import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function ensureInventoryGraph(database: Database) {
  const nodes = database.collection('inventoryNodes');
  if (!await nodes.exists()) await nodes.create();
  await nodes.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userKey', 'kind', 'createdAt'] });
  await nodes.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userKey', 'runKey', 'index'], unique: true });

  const edges = database.collection('inventoryEdges');
  if (!await edges.exists()) await database.createEdgeCollection('inventoryEdges');
  await edges.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userKey', 'kind', 'fromKey'] });
  await edges.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userKey', 'toKey'] });
}

export const inventoryGraphMigration: GraphMigration = {
  id: '0011-inventory-graph',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: ensureInventoryGraph,
};
