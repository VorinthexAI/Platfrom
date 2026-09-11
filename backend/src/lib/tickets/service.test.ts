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
  test('creates and links a private inbox thread and initial message', async () => {
    let stored: Parameters<TicketRepository['createOrReplay']> | undefined;
    const repository = { createOrReplay: async (...args: Parameters<TicketRepository['createOrReplay']>) => { stored = args; return { state: 'created' as const, ticket: args[0] }; } } as TicketRepository;
    const ids = [newId(), newId(), newId()]; let index = 0;
    const result = await createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), id: () => ids[index++]!, now: () => now }).submit({ message: '  Please help  ' }, context, 'request-1');
    expect(result).toEqual({ key: ids[0], threadKey: ids[1], initialMessageKey: ids[2], message: 'Please help', kind: 'issue', createdAt: now });
    expect(stored?.[1]).toMatchObject({ key: ids[1], ticketKey: ids[0], kind: 'issue', userKey });
    expect(stored?.[2]).toMatchObject({ key: ids[2], threadKey: ids[1], sender: 'user', body: 'Please help' });
    expect(stored?.[3]).toBe(teamMembershipKey);
  });

  test('rejects forged principals and maps repository outcomes', async () => {
    const embed = async () => Array(EMBEDDING_DIMENSIONS).fill(0);
    await expect(createTicketService({ repository: {} as TicketRepository, embed }).submit({ message: 'Help' }, { ...context, principal: { kind: 'system' } }, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    await expect(createTicketService({ repository: { createOrReplay: async () => ({ state: 'forbidden' }) } as unknown as TicketRepository, embed }).submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    await expect(createTicketService({ repository: { createOrReplay: async () => ({ state: 'conflict' }) } as unknown as TicketRepository, embed }).submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketIdempotencyError);
  });

  test('classifies feedback before creating its private thread', async () => {
    const calls: unknown[][] = [];
    const repository = { createOrReplay: async (...args: any[]) => { calls.push(args); return { state: 'created' as const, ticket: args[0] }; } } as TicketRepository;
    const service = createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), ask: (async () => askResult('{"valid":true}')) as typeof executeAsk, now: () => now });
    await expect(service.createFeedback({ message: 'Add keyboard shortcuts' }, context, 'feedback-1')).resolves.toMatchObject({ kind: 'feedback' });
    expect(calls[0]?.[1]).toMatchObject({ kind: 'feedback', subject: 'Product feedback' });
    const rejected = createTicketService({ repository, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0), ask: (async () => askResult('{"valid":false}')) as typeof executeAsk });
    await expect(rejected.createFeedback({ message: 'asdf' }, context, 'feedback-2')).rejects.toBeInstanceOf(TicketFeedbackRejectedError);
  });
});
