import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { bookSchema } from '@/lib/db/books.node';
import { bookContextSchema } from '@/lib/db/book-contexts.node';
import { replayableShareSchema } from '@/lib/db/shares.node';
import { createBookRepository, type BookDatabase } from './repository';

describe('book share persistence', () => {
  test('atomically inserts exactly one inactive replayable share with a new book', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); const now = '2026-08-28T12:00:00.000Z'; const embedding = Array(EMBEDDING_DIMENSIONS).fill(0); const queries: Array<{ query: string; bind: Record<string, unknown> }> = []; let writes: string[] = [];
    const book = bookSchema.parse({ key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Goal', audience: 'Audience', outcome: 'Outcome', language: 'English', generationOwnerKey: userKey, status: 'queued', embedding, createdAt: now, updatedAt: now });
    const context = bookContextSchema.parse({ key: newId(), scopeKey, bookKey, userContext: 'User', priorKnowledge: 'Prior', priorBookContext: 'Book', personalizationContext: 'Personal', researchContext: 'Research', noveltyContext: 'Novelty', generationBrief: 'Brief', embedding, createdAt: now, updatedAt: now });
    const share = replayableShareSchema.parse({ key: newId(), scopeKey, sourceType: 'book', sourceKey: bookKey, permission: 'read', tokenHash: 'a'.repeat(64), responseCiphertext: 'v1:a:b:c', revokedAt: now, createdAt: now, updatedAt: now });
    const database: BookDatabase = { async query(query, bind = {}) { queries.push({ query, bind }); if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] }; if (query.includes('INSERT @book')) return { all: async () => [{ ...book, _key: book.key }] }; return { all: async () => [] }; } };
    const transact = async <T>(collections: { write: string[] }, run: (transaction: BookDatabase) => Promise<T>) => { writes = collections.write; return run(database); };
    await expect(createBookRepository(database, transact).create({ organizationKey: 'organization', scopeKey, userKey }, book, context, [], share)).resolves.toMatchObject({ key: bookKey });
    expect(writes).toEqual(expect.arrayContaining(['books', 'bookContexts', 'bookSources', 'shares']));
    expect(queries.filter(({ query }) => query.includes('INSERT @share INTO shares'))).toHaveLength(1);
    const persisted = queries.find(({ query }) => query.includes('INSERT @share INTO shares'))?.bind.share as Record<string, unknown>;
    expect(persisted).toMatchObject({ sourceType: 'book', sourceKey: bookKey, revokedAt: now, tokenHash: 'a'.repeat(64), responseCiphertext: 'v1:a:b:c' });
    expect(JSON.stringify(persisted)).not.toContain('https://vorinthex.com');
  });

  test('rejects creation when the mandatory share is active or not replayable', async () => {
    const repository = createBookRepository({ query: async () => ({ all: async () => ['membership'] }) }, async (_collections, run) => run({ query: async (query) => ({ all: async () => query.includes('RETURN membership._key') ? ['membership'] : [] }) }));
    await expect(repository.create({ organizationKey: 'organization', scopeKey: newId(), userKey: newId() }, {} as never, {} as never, [], {} as never)).rejects.toBeDefined();
  });

  test('does not activate a share until its book is ready', async () => {
    const scopeKey = newId(); const userKey = newId(); const bookKey = newId();
    const database: BookDatabase = { async query(query) { if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] }; if (query.includes('LET updated = !@active')) return { all: async () => [{ status: 'writing', share: null }] }; return { all: async () => [] }; } };
    await expect(createBookRepository(database).setShareActive({ organizationKey: 'organization', scopeKey, userKey }, bookKey, true, '2026-08-28T12:00:00.000Z')).rejects.toMatchObject({ reason: 'conflict', message: 'Only ready audio books can be shared.' });
  });
});
