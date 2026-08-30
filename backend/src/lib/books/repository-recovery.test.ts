import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book generation failure persistence', () => {
  test('records failure only through the released-or-expired lease guard', async () => {
    const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); const now = '2026-08-25T12:00:00.000Z'; let queryText = ''; let bindings: Record<string, unknown> = {};
    const database: BookDatabase = { async query(query, bind = {}) { queryText = query; bindings = bind; return { all: async () => [1] }; } };
    const repository = createBookRepository(database);

    await expect(repository.failGeneration({ bookKey, organizationKey: 'organization', scopeKey, userKey }, 'safe failure', now)).resolves.toBe(true);
    expect(queryText).toContain('book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now');
    expect(bindings).toEqual({ bookKey, organizationKey: 'organization', scopeKey, userKey, message: 'safe failure', now });
  });
});
