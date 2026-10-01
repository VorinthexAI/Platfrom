import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const supportTicketsMigration: GraphMigration = {
  id: '0009-support-tickets',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  async up(database: Database) {
    const tickets = database.collection('tickets');
    if (!await tickets.exists()) await tickets.create();
    await tickets.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'type', 'createdAt'] });
    await tickets.ensureIndex({ type: 'persistent', fields: ['userKey', 'scopeKey', 'createdAt'] });
    await tickets.ensureIndex({ type: 'persistent', fields: ['userKey', 'idempotencyKey'], unique: true });
    const votes = database.collection('ticketVotes');
    if (!await votes.exists()) await votes.create();
    await votes.ensureIndex({ type: 'persistent', fields: ['ticketKey', 'userKey'], unique: true });
    await votes.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'ticketKey'] });
    await votes.ensureIndex({ type: 'persistent', fields: ['userKey'] });
  },
};
