import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createTicketRepository, type Ticket, type TicketDatabase } from './repository';

const ticket = (): Ticket => ({
  key: newId(), organizationKey: newId(), scopeKey: newId(), userKey: newId(), message: 'Need help',
  embedding: Array(EMBEDDING_DIMENSIONS).fill(0), idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), type: 'issue', createdAt: '2026-09-03T10:00:00.000Z',
});

describe('ticket repository', () => {
  test('atomically declares authorization reads and the ticket write', async () => {
    const value = ticket();
    let declaration: unknown;
    let query = '';
    let bindVars: Record<string, unknown> = {};
    const database: TicketDatabase = { query: async () => { throw new Error('outside transaction'); } };
    const repository = createTicketRepository(database, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text, vars) => {
        query = text;
        bindVars = vars ?? {};
        return { next: async () => ({ ticket: { ...(bindVars.ticket as object), _key: value.key }, previousHash: null }) };
      } });
    });
    await expect(repository.createOrReplay(value, newId())).resolves.toEqual({ state: 'created', ticket: value });
    expect(declaration).toEqual({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers'], write: ['tickets'] });
    expect(query).toContain('LET user = DOCUMENT(users, @userKey)');
    expect(query).toContain('FILTER user != null');
    expect(query).toContain('membership.status == "active"');
    expect(query).toContain('scopeMember != null');
    expect(query).toContain('UPSERT');
    expect(bindVars.ticket).not.toHaveProperty('key');
    expect(bindVars.ticket).toHaveProperty('_key', value.key);
  });

  test('returns replay, payload conflict, and forbidden states', async () => {
    const value = ticket();
    const result = async (row: unknown) => createTicketRepository({ query: async () => ({ next: async () => row }) }, async (_collections, operation) => operation({ query: async () => ({ next: async () => row }) })).createOrReplay(value, newId());
    const stored = { ...value, _key: value.key };
    delete (stored as Partial<Ticket> & { _key?: string }).key;
    await expect(result({ ticket: stored, previousHash: value.requestHash })).resolves.toMatchObject({ state: 'replay', ticket: value });
    await expect(result({ ticket: stored, previousHash: 'b'.repeat(64) })).resolves.toEqual({ state: 'conflict' });
    await expect(result(undefined)).resolves.toEqual({ state: 'forbidden' });
  });

  test('returns forbidden when the transactional authorization check finds no user', async () => {
    const value = ticket();
    let query = '';
    const repository = createTicketRepository({ query: async () => { throw new Error('outside transaction'); } }, async (_collections, operation) => operation({
      query: async (text) => {
        query = text;
        return { next: async () => undefined };
      },
    }));

    await expect(repository.createOrReplay(value, newId())).resolves.toEqual({ state: 'forbidden' });
    expect(query).toContain('LET user = DOCUMENT(users, @userKey)');
  });

  test('lists feedback with viewer votes and a bounded cursor under transactional authorization', async () => {
    const value = { ...ticket(), type: 'feedback' as const, upvotes: 3, downvotes: 1 };
    let declaration: unknown, query = '', bindVars: Record<string, unknown> = {};
    const repository = createTicketRepository({ query: async () => { throw new Error('outside transaction'); } }, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text, vars) => { query = text; bindVars = vars ?? {}; return { next: async () => ({ authorized: true, rows: [{ ticket: { ...value, key: undefined, _key: value.key }, viewerVote: 'up' }] }) }; } });
    });
    await expect(repository.listFeedback({ organizationKey: value.organizationKey, scopeKey: value.scopeKey, userKey: value.userKey, membershipKey: newId(), limit: 20 })).resolves.toEqual({ state: 'ok', tickets: [{ ticket: value, viewerVote: 'up' }], nextCursor: null });
    expect(declaration).toEqual({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers', 'tickets', 'ticketVotes'], write: [] });
    expect(query).toContain('ticket.type == "feedback"');
    expect(query).toContain('item.userKey == @userKey');
    expect(bindVars.pageSize).toBe(21);
  });

  test('atomically replaces one vote and derives both ticket counts', async () => {
    const value = { ...ticket(), type: 'feedback' as const, upvotes: 1, downvotes: 0 };
    let declaration: unknown;
    const queries: string[] = [];
    const repository = createTicketRepository({ query: async () => { throw new Error('outside transaction'); } }, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text) => {
        queries.push(text);
        if (text.includes('RETURN { authorized, selected:')) return { next: async () => ({ authorized: true, selected: true }) };
        if (text.includes('COLLECT AGGREGATE')) return { next: async () => ({ upvotes: 1, downvotes: 0 }) };
        if (text.includes('RETURN NEW')) return { next: async () => ({ ...value, key: undefined, _key: value.key }) };
        return { next: async () => undefined };
      } });
    });
    await expect(repository.setFeedbackVote({ organizationKey: value.organizationKey, scopeKey: value.scopeKey, userKey: value.userKey, membershipKey: newId(), ticketKey: value.key, vote: 'up', voteKey: newId(), now: value.createdAt })).resolves.toMatchObject({ state: 'ok', viewerVote: 'up' });
    expect(declaration).toEqual({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers'], write: ['tickets', 'ticketVotes'] });
    expect(queries).toHaveLength(4);
    expect(queries[0]).toContain('RETURN { authorized, selected: selected != null }');
    expect(queries[1]).toContain('UPSERT { ticketKey: @ticketKey, userKey: @userKey }');
    expect(queries[1]).toContain('UPDATE { vote: @vote, updatedAt: @now }');
    expect(queries[2]).toContain('upvotes = SUM(item.vote == "up"');
    expect(queries[2]).toContain('downvotes = SUM(item.vote == "down"');
    expect(queries[3]).toContain('UPDATE @ticketKey WITH { upvotes: @upvotes, downvotes: @downvotes }');
  });
});
