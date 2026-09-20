import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { applyHiddenScopeVisibility, hiddenScopeVisibilityMigration } from './0017-hidden-scope-visibility';

test('hides root Core and Vorinthex AI scopes and registers the migration', async () => {
  const queries: string[] = [];
  await applyHiddenScopeVisibility({
    query: async (source: string) => {
      queries.push(source);
      return { all: async () => [] };
    },
  } as never);
  expect(queries.join('\n')).toContain('scope.slug == "vorinthex-ai" || scope.slug == "core"');
  expect(queries.join('\n')).toContain('visibility: "hidden"');
  expect(graphMigrations.find(({ id }) => id === hiddenScopeVisibilityMigration.id)).toBe(hiddenScopeVisibilityMigration);
  expect(hiddenScopeVisibilityMigration.id).toBe('0017-hidden-scope-visibility');
});
