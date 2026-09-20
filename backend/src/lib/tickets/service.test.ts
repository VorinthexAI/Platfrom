import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createTicketService, TicketAccessError, TicketFeedbackRejectedError, TicketIdempotencyError } from './service';
import type { TicketRepository } from './repository';
import type { executeAsk } from '@/lib/ai/router';

const teamKey = newId(), scopeKey = newId(), userKey = newId(), teamMembershipKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: teamMembershipKey, teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const now = '2026-09-03T10:00:00.000Z';
const askResult = (text: string) => ({ output: { text, toolCalls: [], stopReason: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: 'openrouter', modelId: 'model', externalModelId: 'external', rawResponse: {} });

describe('ticket service', () => {
  test('creates a ticket without an inbox thread', async () => {
    let stored: Parameters<TicketRepository['createOrReplay']> | undefined;
    const repository = { createOrReplay: async (...args: Parameters<TicketRepository['createOrReplay']>) => { stored = args; return { state: 'created' as const, ticket: args[0] }; } } as TicketRepository;
    const key = newId();
    const published: unknown[] = [];
    const result = await createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), id: () => key, now: () => now, publishChanged: async (...args) => { published.push(args); } }).submit({ message: '  Please help  ' }, context, 'request-1');
    expect(result).toEqual({ key, message: 'Please help', kind: 'issue', createdAt: now });
    expect(stored?.[0]).toMatchObject({ key, type: 'issue', userKey, message: 'Please help' });
    expect(stored?.[1]).toBe(teamMembershipKey);
    expect(published).toEqual([[userKey, 'communication.changed']]);
  });

  test('rejects forged principals and maps repository outcomes', async () => {
    const embed = async () => Array(EMBEDDING_DIMENSIONS).fill(0);
    await expect(createTicketService({ repository: {} as TicketRepository, embed }).submit({ message: 'Help' }, { ...context, principal: { kind: 'system' } }, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    await expect(createTicketService({ repository: { createOrReplay: async () => ({ state: 'forbidden' }) } as unknown as TicketRepository, embed }).submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    await expect(createTicketService({ repository: { createOrReplay: async () => ({ state: 'conflict' }) } as unknown as TicketRepository, embed }).submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketIdempotencyError);
  });

  test('classifies feedback before creating a ticket', async () => {
    const calls: unknown[][] = [];
    const repository = { createOrReplay: async (...args: any[]) => { calls.push(args); return { state: 'created' as const, ticket: args[0] }; } } as TicketRepository;
    const service = createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), ask: (async () => askResult('{"valid":true}')) as typeof executeAsk, now: () => now, publishChanged: async () => {} });
    await expect(service.submit({ message: 'Add keyboard shortcuts', kind: 'feedback' }, context, 'feedback-1')).resolves.toMatchObject({ kind: 'feedback' });
    expect(calls[0]?.[0]).toMatchObject({ type: 'feedback' });
    const rejected = createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), ask: (async () => askResult('{"valid":false}')) as typeof executeAsk });
    await expect(rejected.submit({ message: 'asdf', kind: 'feedback' }, context, 'feedback-2')).rejects.toBeInstanceOf(TicketFeedbackRejectedError);
  });

  test('lists tickets through the canonical repository', async () => {
    const ticket = { key: newId(), teamKey, scopeKey, userKey, message: 'Help', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), type: 'issue' as const, createdAt: now };
    const repository = { list: async () => ({ items: [ticket], nextCursor: null }) } as unknown as TicketRepository;
    await expect(createTicketService({ repository }).list({ limit: 10 }, context)).resolves.toEqual({ items: [{ key: ticket.key, message: 'Help', kind: 'issue', createdAt: now }], nextCursor: null });
  });
});
