import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function allowMultipleChargesPerEvent(database: Database) {
  const transactions = database.collection('sparkTransactions');
  for (const index of await transactions.indexes()) {
    if (index.type === 'persistent' && index.unique && index.fields.length === 1 && index.fields[0] === 'eventKey') {
      await transactions.dropIndex(index.id);
    }
  }
  await transactions.ensureIndex({ type: 'persistent', fields: ['eventKey'], unique: false, sparse: true });
}

export const actionEventIndexMigration: GraphMigration = {
  id: '0005-action-event-index',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: allowMultipleChargesPerEvent,
};
