import { describe, expect, test } from 'bun:test';
import { SCOPE_KEYED_REMOVAL_COLLECTIONS } from '@/lib/ai/scopes/repository';
import { createAccountDeletionRepository } from './repository';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const teamKey = 'cmrnlzf650002qc7k4p5zem5x';
const cursor = (value: unknown) => ({
  async next() { return value; },
  async all() { return Array.isArray(value) ? value : value == null ? [] : [value]; },
});
const plan = (overrides: Record<string, unknown> = {}) => ({ userKey, teamKeys: [teamKey], scopeKeys: [], presenceSessionKeys: ['session-1'], blocked: false, activeCheckout: false, recoverableCheckout: false, ...overrides });

describe('account deletion repository', () => {
  test('writes a durable fence in a short transaction with deterministic user/session lock ordering', async () => {
    const queries: string[] = []; let declaration: unknown;
    const repository = createAccountDeletionRepository({ async query() { return cursor(null); } }, async (collections, operation) => {
      declaration = collections;
      return operation({ async query(query: string) { queries.push(query); return cursor(queries.length === 1 ? plan() : userKey); } });
    });
    await expect(repository.fence(userKey, '2026-09-06T09:55:00.000Z', '2026-09-06T10:00:00.000Z')).resolves.toEqual({ status: 'fenced', presenceSessionKeys: ['session-1'] });
    expect(declaration).toEqual(expect.objectContaining({ write: ['users', 'userSessions'] }));
    expect(queries[0]).toContain('checkout.updatedAt < @pendingCutoff');
    expect(queries[1]).toContain('deletionRequestedAt');
  });

  test('classifies stale pending checkout separately and does not write the fence', async () => {
    let queries = 0;
    const repository = createAccountDeletionRepository({ async query() { return cursor(null); } }, async (_collections, operation) => operation({ async query() { queries += 1; return cursor(plan({ recoverableCheckout: true })); } }));
    await expect(repository.fence(userKey, '2026-09-06T09:55:00.000Z', '2026-09-06T10:00:00.000Z')).resolves.toEqual({ status: 'checkout_recovery_required' });
    expect(queries).toBe(1);
  });

  test('final teardown requires the fence and performs no external callback or ordinary database read', async () => {
    const outsideReads: string[] = []; const transactionQueries: string[] = [];
    const repository = createAccountDeletionRepository(
      { async query(query: string) { outsideReads.push(query); return cursor(null); } },
      async (_collections, operation) => operation({ async query(query: string) {
        transactionQueries.push(query);
        if (transactionQueries.length === 1) return cursor(plan());
        if (query.includes('IS_STRING(user.deletionRequestedAt)')) return cursor(true);
        if (query.includes('RETURN presenceSessionKeys')) return cursor(['session-1']);
        return cursor(null);
      } }),
    );
    await expect(repository.finalize(userKey)).resolves.toEqual({ status: 'deleted' });
    expect(outsideReads).toEqual([]);
    expect(transactionQueries.some((query) => query.includes('REMOVE user IN users'))).toBe(true);
  });

  test('tears down multiple scopes with one statement per scope-owned collection', async () => {
    const scopeKeys = ['scope-1', 'scope-2'];
    const transactionQueries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const repository = createAccountDeletionRepository(
      { async query() { return cursor(null); } },
      async (_collections, operation) => operation({ async query(query: string, bindVars: Record<string, unknown> = {}) {
        transactionQueries.push({ query, bindVars });
        if (query.includes('LET user = DOCUMENT(users, @userKey)') && query.includes('recoverableCheckout')) return cursor(plan({ scopeKeys }));
        if (query.includes('IS_STRING(user.deletionRequestedAt)')) return cursor(true);
        if (query.includes('scope.slug IN @productSlugs')) return cursor(0);
        if (query.includes('RETURN DOCUMENT(scopes, @scopeKey)')) return cursor(1);
        if (query.includes('LET otherTeamMember')) return cursor(0);
        if (query.includes('user.currentScopeKey')) return cursor(0);
        if (query.includes('LET storageKeys =')) return cursor([]);
        if (query.includes('REMOVE scope IN scopes')) return cursor(bindVars.scopeKey);
        if (query.includes('RETURN { authoredTicketKeys, votedTicketKeys }')) return cursor({ authoredTicketKeys: [], votedTicketKeys: [] });
        if (query.includes('RETURN presenceSessionKeys')) return cursor(['session-1']);
        return cursor(null);
      } }),
    );

    await expect(repository.finalize(userKey)).resolves.toEqual({ status: 'deleted' });
    for (const collection of ['generatedDocumentBindings', 'collectionImages']) {
      expect(transactionQueries.filter(({ query, bindVars }) => query.includes('REMOVE item IN @@collection') && bindVars['@collection'] === collection)).toHaveLength(scopeKeys.length);
    }
    expect(transactionQueries.filter(({ query }) => query.includes('REMOVE item IN @@collection'))).toHaveLength(scopeKeys.length * SCOPE_KEYED_REMOVAL_COLLECTIONS.length);
    expect(transactionQueries.some(({ query }) => query.includes('cleanupTicketVotes'))).toBe(false);
    expect(transactionQueries.some(({ query }) => query.includes('UPDATE item WITH counts IN tickets'))).toBe(true);
  });
});
