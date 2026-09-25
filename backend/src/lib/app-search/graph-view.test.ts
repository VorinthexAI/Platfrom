import { describe, expect, test } from 'bun:test';
import { ensureWorkspaceSearchView, WORKSPACE_SEARCH_FIELDS } from './graph-view';

describe('database-maintained workspace search index', () => {
  test('links only approved data, without copying records or indexing credentials', async () => {
    let created: unknown;
    const database = { view: () => ({ exists: async () => false, create: async (input: unknown) => { created = input; } }) } as never;
    await ensureWorkspaceSearchView(database);
    const links = (created as any).links;
    expect(Object.keys(links).sort()).toEqual(Object.keys(WORKSPACE_SEARCH_FIELDS).sort());
    expect(links.images.fields.caption.analyzers).toEqual(['text_en']);
    expect(links.images.fields.scopeKey.analyzers).toEqual(['identity']);
    for (const excluded of ['users', 'authSessions', 'userConnectors', 'storageObjects', 'sparkTransactions']) expect(links[excluded]).toBeUndefined();
    for (const entry of Object.values(links) as any[]) expect(entry.includeAllFields).toBe(false);
  });

  test('repairs existing view links during migration reruns', async () => {
    let updated: unknown;
    await ensureWorkspaceSearchView({ view: () => ({ exists: async () => true, updateProperties: async (input: unknown) => { updated = input; } }) } as never);
    expect(Object.keys((updated as any).links)).toContain('books');
  });
});
