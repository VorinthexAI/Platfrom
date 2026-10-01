import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

async function ensureScopeTags(database: Database) {
  const tags = database.collection('tags');
  if (!await tags.exists()) await tags.create();
  await tags.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userKey', 'normalizedName'], unique: true });

  const assignments = database.collection('tagAssignments');
  if (!await assignments.exists()) await assignments.create();
  await assignments.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'tagKey', 'sourceType', 'sourceKey'], unique: true });
  await assignments.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'sourceType', 'sourceKey'] });
  await assignments.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'tagKey'] });
}

export const scopeTagsMigration: GraphMigration = {
  id: '0006-scope-tags',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: ensureScopeTags,
};
