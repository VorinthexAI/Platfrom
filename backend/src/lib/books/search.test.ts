import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase, type BookRepository } from './repository';
import { bookSearchInputSchema, createBookService } from './service';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const bookKey = newId();
const timestamp = '2026-08-25T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const book = { key: bookKey, scopeKey, title: 'Decisions', description: 'Decide well', goal: 'Decide well', audience: 'Readers', outcome: 'Better decisions', language: 'English', generationStage: 'complete' as const, generationCompletedUnits: 1, generationTotalUnits: 1, generationAttempt: 0, estimatedMinutes: 10, chapterCount: 10, isFavorite: false, status: 'ready' as const, embedding, createdAt: timestamp };

describe('book semantic search creation dates', () => {
  test('rejects reversed ranges and forwards inclusive boundaries to the repository', async () => {
    const reversed = bookSearchInputSchema.safeParse({ organizationKey, scopeKey, query: 'decisions', createdFrom: '2026-08-26T00:00:00.000Z', createdTo: timestamp });
    expect(reversed.success).toBe(false);
    if (!reversed.success) expect(reversed.error.issues.map((issue) => issue.path.join('.'))).toContain('createdTo');

    let range: unknown;
    const repository = { search: async (_context: unknown, _query: string, _vector: number[], _minimumScore: number, _limit: number, dateRange: unknown) => { range = dateRange; return [{ book, chapters: [], score: 1 }]; } } as unknown as BookRepository;
    const result = await createBookService({ repository, signUrl: async () => 'signed' }).search({ organizationKey, scopeKey, query: 'decisions', createdFrom: timestamp, createdTo: timestamp }, userKey, { queryEmbedding: embedding });
    expect(range).toEqual({ createdFrom: timestamp, createdTo: timestamp });
    expect(result.books[0]).toMatchObject({ key: bookKey, createdAt: timestamp, updatedAt: timestamp, score: 1 });
  });

  test('binds inclusive creation-date predicates before semantic ranking and limit', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: BookDatabase = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : [{ book: { ...book, _key: bookKey }, chapters: [], score: 1 }]; } }; } };
    const rows = await createBookRepository(database).search({ organizationKey, scopeKey, userKey }, 'decisions', embedding, -1, 10, { createdFrom: timestamp, createdTo: timestamp });
    expect(rows[0]?.book).toMatchObject({ key: bookKey, createdAt: timestamp, updatedAt: timestamp });
    const search = calls[1]!;
    expect(search.query.indexOf('book.createdAt >= @createdFrom')).toBeLessThan(search.query.indexOf('COSINE_SIMILARITY'));
    expect(search.query.indexOf('book.createdAt <= @createdTo')).toBeLessThan(search.query.indexOf('COSINE_SIMILARITY'));
    expect(search.query.indexOf('book.createdAt <= @createdTo')).toBeLessThan(search.query.indexOf('LIMIT @limit'));
    expect(search.bindVars).toMatchObject({ createdFrom: timestamp, createdTo: timestamp, limit: 10 });
  });
});
