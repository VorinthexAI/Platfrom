import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createTicketRepository, type Ticket, type TicketDatabase } from './repository';

const now = '2026-09-03T10:00:00.000Z';
function values() {
  const ticket: Ticket = { key: newId(), teamKey: newId(), scopeKey: newId(), userKey: newId(), message: 'Need help', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), type: 'issue', createdAt: now };
  return ticket;
}

describe('ticket repository', () => {
  test('atomically authorizes and creates the ticket without inbox writes', async () => {
    const ticket = values(); let declaration: unknown, query = '', bindVars: Record<string, unknown> = {};
    const repository = createTicketRepository({ query: async () => { throw new Error('outside transaction'); } } as TicketDatabase, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text, vars) => { query = text; bindVars = vars ?? {}; return { next: async () => ({ ticket: { ...(bindVars.ticket as object), _key: ticket.key }, previousHash: null }) }; } });
    });
    await expect(repository.createOrReplay(ticket, newId())).resolves.toEqual({ state: 'created', ticket });
    expect(declaration).toEqual({ read: ['users', 'userTeams', 'scopes', 'scopeMembers'], write: ['tickets'] });
    expect(query).not.toContain('userInboxThreads');
    expect(bindVars.ticket).not.toHaveProperty('key');
  });

  test('pages tickets ten at a time with a next cursor', async () => {
    const owner = { teamKey: newId(), scopeKey: newId(), userKey: newId() };
    const rows = Array.from({ length: 11 }, (_, index) => ({ _key: newId(), teamKey: owner.teamKey, scopeKey: owner.scopeKey, userKey: owner.userKey, message: `Help ${index}`, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), idempotencyKey: `request-${index}`, requestHash: 'a'.repeat(64), type: 'issue', createdAt: now }));
    const repository = createTicketRepository({ query: async (_query, bindVars) => ({ next: async () => ({ items: rows.slice(0, Number(bindVars?.pageSize ?? 11)) }), all: async () => [] }) });
    const page = await repository.list(owner, { limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe(rows[9]!._key);
  });

  test('returns replay, payload conflict, and forbidden without duplicate writes', async () => {
    const ticket = values();
    const result = async (row: unknown) => createTicketRepository({ query: async () => ({ next: async () => row }) }, async (_collections, operation) => operation({ query: async () => ({ next: async () => row }) })).createOrReplay(ticket, newId());
    const stored = { ...ticket, key: undefined, _key: ticket.key };
    await expect(result({ ticket: stored, previousHash: ticket.requestHash })).resolves.toMatchObject({ state: 'replay', ticket });
    await expect(result({ ticket: stored, previousHash: 'b'.repeat(64) })).resolves.toEqual({ state: 'conflict' });
    await expect(result(undefined)).resolves.toEqual({ state: 'forbidden' });
  });
});
