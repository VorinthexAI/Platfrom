import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository } from './repository';

describe('book Archive publication', () => {
  test('commits canonical readiness before ensuring ordinary Archive copies', async () => {
    const queries: string[] = [];
    const database: any = { query: async (query: string) => { queries.push(query); return { all: async () => query.includes('userOrganizations') ? [1] : query.includes('UPDATE book WITH { status: "ready"') ? [10] : [] }; } };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    await repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString());
    const canonical = queries.find((query) => query.includes('UPDATE book WITH { status: "ready"'))!;
    const archive = queries.find((query) => query.includes('chapter-export'))!;
    expect(canonical).toContain('DOCUMENT(books, @bookKey)'); expect(canonical).toContain('FOR chapter IN bookChapters'); expect(canonical).not.toContain('folders'); expect(canonical).not.toContain('documents'); expect(canonical).not.toContain('archiveFolderKey'); expect(canonical).not.toContain('archiveDocumentKey');
    expect(queries.indexOf(canonical)).toBeLessThan(queries.indexOf(archive));
    expect(archive.match(/UPSERT/g)).toHaveLength(3); expect(archive.match(/UPDATE \{\}/g)).toHaveLength(3);
    expect(archive).toContain('parentFolderKey: rootKey'); expect(archive).toContain('mutationPolicy: "user"'); expect(archive).not.toContain('purpose'); expect(archive).not.toContain('managedPurpose'); expect(archive).not.toContain('managedOwnerKey'); expect(archive).not.toContain('system-container'); expect(archive).not.toContain('system-only');
  });

  test('keeps canonical publication successful when Archive export fails', async () => {
    let transactions = 0;
    const database: any = { query: async (query: string) => ({ all: async () => query.includes('userOrganizations') ? [1] : query.includes('UPDATE book WITH { status: "ready"') ? [10] : [] }) };
    const repository = createBookRepository(database, async (_collections, operation) => { transactions += 1; if (transactions === 2) throw new Error('archive unavailable'); return operation(database); });
    await expect(repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString())).resolves.toBeUndefined();
    expect(transactions).toBe(2);
  });

  test('rejects canonical publication when an atomic prerequisite is missing', async () => {
    let transactions = 0;
    const database: any = { query: async (query: string) => ({ all: async () => query.includes('userOrganizations') ? [1] : [] }) };
    const repository = createBookRepository(database, async (_collections, operation) => { transactions += 1; return operation(database); });
    await expect(repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString())).rejects.toMatchObject({ reason: 'conflict' });
    expect(transactions).toBe(1);
  });
});
