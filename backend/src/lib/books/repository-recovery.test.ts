import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book generation failure persistence', () => {
  test('terminalizes and enqueues the exact linked refund only for the active lease owner', async () => {
    const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); const intentKey = newId(); const now = '2026-08-25T12:00:00.000Z'; let queryText = ''; let bindings: Record<string, unknown> = {}; let collections: unknown;
    const database: BookDatabase = { async query(query, bind = {}) { queryText = query; bindings = bind; return { all: async () => [1] }; } };
    const repository = createBookRepository(database, async (target, operation) => { collections = target; return operation(database); });

    await expect(repository.terminalizeGeneration({ bookKey, organizationKey: 'organization', scopeKey, userKey }, 'lease-token', 'safe failure', intentKey, now)).resolves.toBe(true);
    expect(queryText).toContain('book.generationLeaseToken == @leaseToken');
    expect(queryText).toContain('generationLeaseToken: null');
    expect(queryText).toContain('UPSERT { chargeTransactionKey: refundable.transactionKey }');
    expect(queryText).toContain('chapter.position > extension.baseChapterCount');
    expect(queryText).toContain('status: "ready"');
    expect(collections).toMatchObject({ write: expect.arrayContaining(['books', 'bookExtensions', 'bookRefundIntents', 'storageDeletionJobs']) });
    expect(bindings).toEqual({ bookKey, organizationKey: 'organization', scopeKey, userKey, leaseToken: 'lease-token', message: 'safe failure', intentKey, now });
  });

  test('lists a bounded set of unleased accepted generations for process recovery', async () => {
    const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); let queryText = ''; let bindings: Record<string, unknown> = {};
    const database: BookDatabase = { async query(query, bind = {}) { queryText = query; bindings = bind; return { all: async () => [{ bookKey, organizationKey: 'organization', scopeKey, userKey }] }; } };
    const repository = createBookRepository(database);
    await expect(repository.listRecoverableGenerations('2026-08-25T12:00:00.000Z', 100)).resolves.toEqual([{ bookKey, organizationKey: 'organization', scopeKey, userKey }]);
    expect(queryText).toContain('book.generationLeaseExpiresAt <= @now');
    expect(queryText).toContain('LIMIT @limit');
    expect(bindings).toEqual({ now: '2026-08-25T12:00:00.000Z', limit: 100 });
  });
});
