import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';

describe('book source snapshots', () => {
  test('rejects selected hidden or system-managed Archive documents', async () => {
    const scopeKey = newId(); const visibleKey = newId(); const hiddenKey = newId(); let sourceQuery = '';
    const database: BookDatabase = { async query(query, bind = {}) { if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] }; sourceQuery = query; const keys = bind.keys as string[]; return { all: async () => keys.includes(hiddenKey) ? [{ _key: visibleKey, name: 'Visible', content: 'Evidence', updatedAt: '2026-08-25T12:00:00.000Z' }] : [{ _key: visibleKey, name: 'Visible', content: 'Evidence', updatedAt: '2026-08-25T12:00:00.000Z' }] }; } };
    const repository = createBookRepository(database); const context = { organizationKey: 'org', scopeKey, userKey: newId() };
    await expect(repository.sourceDocuments(context, [visibleKey, hiddenKey])).rejects.toMatchObject({ reason: 'forbidden' });
    expect(sourceQuery).toContain('document.mutationPolicy != "system-only"'); expect(sourceQuery).toContain('document._internalDeletion == null');
  });

  test('checks the generation fence and writes sources in one transaction', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); let sourceWrites = 0; let declaration: { read?: string[]; write: string[] } | undefined;
    const database: BookDatabase = { async query(query) {
      if (query.includes('RETURN membership._key') || query.includes('generationLeaseToken == @generationLeaseToken')) return { all: async () => [1] };
      if (query.includes('IN bookSources')) sourceWrites += 1;
      return { all: async () => [] };
    } };
    const transact = async <T>(collections: { read?: string[]; write: string[] }, run: (executor: BookDatabase) => Promise<T>) => { declaration = collections; return run(database); };
    const source = { key: newId(), scopeKey, bookKey, sourceType: 'web' as const, url: 'https://example.com', title: 'Evidence', content: 'Grounded evidence', relevance: 'Research', contentHash: 'a'.repeat(64), embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), createdAt: '2026-08-25T12:00:00.000Z' };
    await createBookRepository(database, transact).addSources({ organizationKey: 'org', scopeKey, userKey, generationLeaseToken: 'owner' }, bookKey, [source]);
    expect(sourceWrites).toBe(1);
    expect(declaration).toEqual({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookSources'] });
  });
});
