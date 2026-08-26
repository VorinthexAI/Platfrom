import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book generation recovery persistence', () => {
  test('enumerates persisted recoverable work and conditionally records terminal failure', async () => {
    const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); const now = '2026-08-25T12:00:00.000Z'; let failed = false;
    const database: BookDatabase = { async query(query, bind = {}) {
      if (query.includes('RETURN { bookKey:')) return { all: async () => [{ bookKey, organizationKey: 'organization', scopeKey, userKey }] };
      if (query.includes('generationOwnerKey == @userKey')) { failed = bind.bookKey === bookKey && bind.scopeKey === scopeKey && bind.userKey === userKey; return { all: async () => failed ? [1] : [] }; }
      return { all: async () => [] };
    } };
    const repository = createBookRepository(database);
    await expect(repository.listRecoverableGenerations(now)).resolves.toEqual([{ bookKey, organizationKey: 'organization', scopeKey, userKey }]);
    await expect(repository.failTerminalGeneration({ bookKey, organizationKey: 'organization', scopeKey, userKey }, 'exhausted', now)).resolves.toBe(true);
    expect(failed).toBe(true);
  });
});
