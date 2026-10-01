import { ensureWorkspaceSearchView } from '../../lib/app-search/graph-view';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export const workspaceSearchViewMigration: GraphMigration = {
  id: '0002-workspace-search-view',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url), new URL('../../lib/app-search/graph-view.ts', import.meta.url)]),
  up: ensureWorkspaceSearchView,
};
