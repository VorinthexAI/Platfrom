import type { Database } from 'arangojs';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export async function applyHiddenScopeVisibility(database: Database) {
  await database.query(`
    FOR scope IN scopes
      LET team = DOCUMENT(teams, scope.teamKey)
      FILTER team != null && team.is_root == true && (scope.slug == "vorinthex-ai" || scope.slug == "core")
      FILTER !HAS(scope, "visibility") || scope.visibility != "hidden"
      UPDATE scope WITH { visibility: "hidden" } IN scopes
  `);
}

export const hiddenScopeVisibilityMigration: GraphMigration = {
  id: '0017-hidden-scope-visibility',
  checksum: () => checksumMigrationFiles([new URL(import.meta.url)]),
  up: applyHiddenScopeVisibility,
};
