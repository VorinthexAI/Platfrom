import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createTicketRepository, type Ticket, type TicketDatabase } from './repository';
import type { UserInboxMessage, UserInboxThread } from '@/lib/user-inbox/schemas';

const now = '2026-09-03T10:00:00.000Z';
function values() {
  const ticket: Ticket = { key: newId(), teamKey: newId(), scopeKey: newId(), userKey: newId(), message: 'Need help', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), type: 'issue', threadKey: newId(), initialMessageKey: newId(), createdAt: now };
  const thread: UserInboxThread = { key: ticket.threadKey, teamKey: ticket.teamKey, scopeKey: ticket.scopeKey, userKey: ticket.userKey, kind: 'issue', subject: 'Support issue', ticketKey: ticket.key, createdBy: 'user', readAt: now, lastMessageAt: now, createdAt: now, updatedAt: now };
  const message: UserInboxMessage = { key: ticket.initialMessageKey, threadKey: thread.key, teamKey: ticket.teamKey, scopeKey: ticket.scopeKey, userKey: ticket.userKey, sender: 'user', senderUserKey: ticket.userKey, body: ticket.message, createdAt: now };
  return { ticket, thread, message };
}

describe('ticket repository', () => {
  test('atomically authorizes and creates the ticket, thread, and initial message', async () => {
    const value = values(); let declaration: unknown, query = '', bindVars: Record<string, unknown> = {};
    const repository = createTicketRepository({ query: async () => { throw new Error('outside transaction'); } } as TicketDatabase, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text, vars) => { query = text; bindVars = vars ?? {}; return { next: async () => ({ ticket: { ...(bindVars.ticket as object), _key: value.ticket.key }, previousHash: null }) }; } });
    });
    await expect(repository.createOrReplay(value.ticket, value.thread, value.message, newId())).resolves.toEqual({ state: 'created', ticket: value.ticket });
    expect(declaration).toEqual({ read: ['users', 'userTeams', 'scopes', 'scopeMembers'], write: ['tickets', 'userInboxThreads', 'userInboxMessages'] });
    expect(query).toContain('INSERT @thread INTO userInboxThreads');
    expect(query).toContain('INSERT @message INTO userInboxMessages');
    expect(bindVars.ticket).not.toHaveProperty('key');
    expect(bindVars.thread).not.toHaveProperty('key');
    expect(bindVars.message).not.toHaveProperty('key');
  });

  test('returns replay, payload conflict, and forbidden without duplicate inbox writes', async () => {
    const value = values();
    const result = async (row: unknown) => createTicketRepository({ query: async () => ({ next: async () => row }) }, async (_collections, operation) => operation({ query: async () => ({ next: async () => row }) })).createOrReplay(value.ticket, value.thread, value.message, newId());
    const stored = { ...value.ticket, key: undefined, _key: value.ticket.key };
    await expect(result({ ticket: stored, previousHash: value.ticket.requestHash })).resolves.toMatchObject({ state: 'replay', ticket: value.ticket });
    await expect(result({ ticket: stored, previousHash: 'b'.repeat(64) })).resolves.toEqual({ state: 'conflict' });
    await expect(result(undefined)).resolves.toEqual({ state: 'forbidden' });
  });
});
