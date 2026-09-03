import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createTicketService, TicketAccessError, TicketFeedbackRejectedError, TicketIdempotencyError } from './service';
import type { TicketRepository } from './repository';
import type { executeAsk } from '@/lib/ai/router';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), membershipKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const askResult = (text: string) => ({ output: { text, toolCalls: [], stopReason: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: 'openrouter', modelId: 'model', externalModelId: 'external', rawResponse: {} });

describe('ticket service', () => {
  test('normalizes, embeds, and persists trusted context while returning only safe fields', async () => {
    let stored: Parameters<TicketRepository['createOrReplay']> | undefined;
    const repository = { createOrReplay: async (...args: Parameters<TicketRepository['createOrReplay']>) => { stored = args; return { state: 'created' as const, ticket: args[0] }; } } as TicketRepository;
    const service = createTicketService({ repository, embed: async (input) => { expect(input).toEqual({ text: 'Please help', purpose: 'document' }); return Array(EMBEDDING_DIMENSIONS).fill(0); }, id: () => 'cm1234567890123456789012', now: () => '2026-09-03T10:00:00.000Z' });
    const result = await service.submit({ message: '  Please help  ' }, context, 'request-1');
    expect(stored?.[0]).toMatchObject({ organizationKey, scopeKey, userKey, message: 'Please help', idempotencyKey: 'request-1' });
    expect(stored?.[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.[1]).toBe(membershipKey);
    expect(result).toEqual({ key: 'cm1234567890123456789012', message: 'Please help', upvotes: 0, downvotes: 0, viewerVote: null, createdAt: '2026-09-03T10:00:00.000Z' });
    expect(result).not.toHaveProperty('embedding');
    expect(result).not.toHaveProperty('requestHash');
  });

  test('rejects forged principals and maps repository outcomes', async () => {
    const embed = async () => Array(EMBEDDING_DIMENSIONS).fill(0);
    const system = { ...context, principal: { kind: 'system' as const } };
    await expect(createTicketService({ repository: {} as TicketRepository, embed }).submit({ message: 'Help' }, system, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    const forbidden = createTicketService({ repository: { createOrReplay: async () => ({ state: 'forbidden' }) } as unknown as TicketRepository, embed });
    await expect(forbidden.submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
    const conflict = createTicketService({ repository: { createOrReplay: async () => ({ state: 'conflict' }) } as unknown as TicketRepository, embed });
    await expect(conflict.submit({ message: 'Help' }, context, 'request-1')).rejects.toBeInstanceOf(TicketIdempotencyError);
    await expect(createTicketService({ repository: {} as TicketRepository, embed }).listFeedback({}, system)).rejects.toBeInstanceOf(TicketAccessError);
    await expect(createTicketService({ repository: {} as TicketRepository, embed }).setFeedbackVote({ ticketKey: newId(), vote: null }, system, 'request-1')).rejects.toBeInstanceOf(TicketAccessError);
  });

  test('strictly validates message and trusted idempotency key', async () => {
    const service = createTicketService({ repository: {} as TicketRepository, embed: async () => [] });
    await expect(service.submit({ message: 'Help', userKey } as never, context, 'request-1')).rejects.toThrow('Unrecognized key');
    await expect(service.submit({ message: '   ' }, context, 'request-1')).rejects.toBeDefined();
    await expect(service.submit({ message: 'Help' }, context, '')).rejects.toBeDefined();
  });

  test('creates, lists, and votes on feedback through trusted repository context', async () => {
    const calls: unknown[][] = [];
    const feedback = {
      key: 'cm1234567890123456789012', organizationKey, scopeKey, userKey, message: 'Dark mode', embedding: Array(EMBEDDING_DIMENSIONS).fill(0),
      idempotencyKey: 'feedback-1', requestHash: 'a'.repeat(64), type: 'feedback' as const, upvotes: 0, downvotes: 0, createdAt: '2026-09-03T10:00:00.000Z',
    };
    const repository = {
      createOrReplay: async (ticket: typeof feedback, membership: string) => { calls.push(['create', ticket, membership]); return { state: 'created' as const, ticket }; },
      listFeedback: async (input: unknown) => { calls.push(['list', input]); return { state: 'ok' as const, tickets: [{ ticket: { ...feedback, upvotes: 2 }, viewerVote: 'up' as const }], nextCursor: feedback.key }; },
      setFeedbackVote: async (input: unknown) => { calls.push(['vote', input]); return { state: 'ok' as const, ticket: { ...feedback, upvotes: 1 }, viewerVote: 'up' as const }; },
    } as unknown as TicketRepository;
    const service = createTicketService({ repository, embed: async () => feedback.embedding, ask: (async () => askResult('{"valid":true}')) as typeof executeAsk, id: () => feedback.key, now: () => feedback.createdAt });
    await expect(service.createFeedback({ message: ' Dark mode ' }, context, 'feedback-1')).resolves.toMatchObject({ message: 'Dark mode', upvotes: 0, downvotes: 0, viewerVote: null });
    await expect(service.listFeedback({}, context)).resolves.toEqual({ items: [{ key: feedback.key, message: feedback.message, upvotes: 2, downvotes: 0, viewerVote: 'up', createdAt: feedback.createdAt }], nextCursor: feedback.key });
    await expect(service.setFeedbackVote({ ticketKey: feedback.key, vote: 'up' }, context, 'vote-1')).resolves.toMatchObject({ upvotes: 1, downvotes: 0, viewerVote: 'up' });
    expect(calls[0]).toEqual(['create', expect.objectContaining({ type: 'feedback', upvotes: 0, downvotes: 0 }), membershipKey]);
    expect(calls[1]).toEqual(['list', { organizationKey, scopeKey, userKey, membershipKey, limit: 20 }]);
    expect(calls[2]).toEqual(['vote', expect.objectContaining({ organizationKey, scopeKey, userKey, membershipKey, ticketKey: feedback.key, vote: 'up' })]);
  });

  test('strictly validates feedback through the provider-neutral text action before persistence', async () => {
    const sequence: string[] = [];
    let actionRequest: unknown;
    const repository = { createOrReplay: async (ticket: never) => { sequence.push('persist'); return { state: 'created' as const, ticket }; } } as unknown as TicketRepository;
    const ask = (async (requestedOrganizationKey: string, input: unknown, options: unknown) => {
      expect(requestedOrganizationKey).toBe(organizationKey);
      actionRequest = { input, options };
      sequence.push('classify');
      return askResult('{"valid":true}');
    }) as typeof executeAsk;
    const service = createTicketService({ repository, ask, embed: async () => { sequence.push('embed'); return Array(EMBEDDING_DIMENSIONS).fill(0); }, id: () => newId(), now: () => '2026-09-03T10:00:00.000Z' });

    await service.createFeedback({ message: 'Add keyboard shortcuts' }, context, 'feedback-2');

    expect(sequence).toEqual(['classify', 'embed', 'persist']);
    expect(actionRequest).toMatchObject({
      input: {
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ message: 'Add keyboard shortcuts' }) }] }],
        options: { temperature: 0, maxTokens: 40 },
        responseFormat: { name: 'feedback_classification', schema: { additionalProperties: false, required: ['valid'], properties: { valid: { type: 'boolean' } } } },
      },
      options: { providers: ['text.primary'], timeoutMs: 8_000 },
    });
  });

  test('rejects non-feature feedback and malformed model output without embedding or persistence', async () => {
    let sideEffects = 0;
    const dependencies = { repository: { createOrReplay: async () => { sideEffects += 1; throw new Error('unexpected persistence'); } } as unknown as TicketRepository, embed: async () => { sideEffects += 1; return Array(EMBEDDING_DIMENSIONS).fill(0); } };
    const rejected = createTicketService({ ...dependencies, ask: (async () => askResult('{"valid":false}')) as typeof executeAsk });
    await expect(rejected.createFeedback({ message: 'asdf qwer' }, context, 'feedback-3')).rejects.toBeInstanceOf(TicketFeedbackRejectedError);
    expect(sideEffects).toBe(0);

    for (const output of ['{"valid":"true"}', '{"valid":true,"reason":"extra"}', '```json\n{"valid":true}\n```', '{invalid']) {
      const malformed = createTicketService({ ...dependencies, ask: (async () => askResult(output)) as typeof executeAsk });
      await expect(malformed.createFeedback({ message: 'Add export' }, context, `feedback-${output.length}`)).rejects.toThrow('malformed structured output');
    }
    expect(sideEffects).toBe(0);
  });
});
