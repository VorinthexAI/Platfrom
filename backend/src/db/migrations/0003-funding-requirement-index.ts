import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function addFundingRequirementIndex(database: Database) {
  await database.collection('conversationMessages').ensureIndex({
    type: 'persistent',
    fields: ['userKey', 'fundingRequiredAcknowledgedAt', 'completedAt', '_key'],
  });
}

export const fundingRequirementIndexMigration: GraphMigration = {
  id: '0003-funding-requirement-index',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: addFundingRequirementIndex,
};
