import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const fileThumbnailsMigration: GraphMigration = {
  id: '0008-file-thumbnails',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  async up(database: Database) {
    await database.collection('files').ensureIndex({ type: 'persistent', fields: ['thumbnailStorageKey'], sparse: true });
  },
};
