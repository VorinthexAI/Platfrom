import type { Database } from 'arangojs';
import { ensureWorkspaceSearchView } from '@/lib/app-search/graph-view';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const workspaceSearchMigration: GraphMigration = {
  id: '0020-workspace-search',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: (database: Database) => ensureWorkspaceSearchView(database),
};
