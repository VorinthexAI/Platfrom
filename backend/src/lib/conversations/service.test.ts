import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import type { ConversationRepository } from './repository';
import { createConversationService, estimateConservativeTokens, trimConversationQueryResults } from './service';
import {
  agentQueryInputSchema, conversationListInputSchema, conversationModelSendInputSchema, conversationSearchInputSchema,
  conversationSendInputSchema, encodeCursor, projectConversationMessage, type ConversationMessage,
} from './schemas';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), conversationKey = newId();
const at = '2026-09-01T10:00:00.000Z';
const owner = { organizationKey, scopeKey, userKey };
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  key: newId(), conversationKey, organizationKey, scopeKey, userKey, turnKey: 'request-1', requestHash: 'a'.repeat(64),
  role: 'ASSISTANT', status: 'COMPLETED', content: 'answer', createdAt: at, completedAt: at, ...overrides,
});

type RepositoryOverrides = Partial<ConversationRepository> & { first?: boolean; recent?: ConversationMessage[] };
function repositoryMock(overrides: RepositoryOverrides = {}) {
  const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); let failed = 0;
  const repository = {
    beginTurn: async (_owner: typeof owner, _conversationKey: string, user: ConversationMessage, assistant: ConversationMessage) => ({ state: 'created' as const, user, assistant: { ...assistant, key: pending.key }, first: overrides.first ?? false }),
    latestCompletedMessages: async () => overrides.recent ?? [], setMessageEmbedding: async () => true,
    completeTurn: async (_owner: typeof owner, _conversation: string, _key: string, content: string, embedding: number[], completedAt: string, generatedName?: string) => ({ message: { ...pending, status: 'COMPLETED' as const, content, embedding, completedAt }, nameApplied: Boolean(generatedName) }),
    failTurn: async () => { failed += 1; }, ...overrides,
  } as unknown as ConversationRepository;
  return { repository, failed: () => failed };
}

describe('private conversations', () => {
  test('keeps agent.query strict and rejects forged trusted selectors before embedding', async () => {
    expect(agentQueryInputSchema.parse({ query: 'history' })).toEqual({ query: 'history', limit: 20 });
    expect(() => agentQueryInputSchema.parse({ query: 'x', limit: 21 })).toThrow();
    for (const forged of ['conversationKey', 'organizationKey', 'scopeKey', 'userKey']) expect(() => agentQueryInputSchema.parse({ query: 'x', [forged]: newId() })).toThrow('Unrecognized key');
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'r', extra: true })).toThrow('Unrecognized key');
    expect(() => conversationModelSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'forged' })).toThrow('Unrecognized key');
    expect(projectConversationMessage(message({ embedding: [1] }))).not.toHaveProperty('embedding');
    let embeds = 0;
    await expect(createConversationService({ repository: {} as ConversationRepository, embed: async () => { embeds += 1; return [1]; } }).query({ ...context, organizationKey: newId() }, { query: 'secret' })).rejects.toThrow('Membership does not belong');
    expect(embeds).toBe(0);
  });

  test('embeds agent.query only when called and performs owner-wide top-20 retrieval', async () => {
    const seen: unknown[] = [];
    const repository = { semanticMessages: async (...args: unknown[]) => { seen.push(args); return []; } } as unknown as ConversationRepository;
    expect(await createConversationService({ repository, embed: async (input) => { seen.push(input); return [0.25]; } }).query(context, { query: ' prior ' })).toEqual({ messages: [] });
    expect(seen).toEqual([{ text: 'prior', purpose: 'query', signal: undefined, timeoutMs: undefined }, [owner, [0.25], 20]]);
  });

  test('orders and conservatively bounds semantic results', () => {
    const rows = [{ message: message({ content: 'old', createdAt: '2026-01-01T00:00:00.000Z' }), similarity: 0.8 }, { message: message({ content: 'new', createdAt: '2026-02-01T00:00:00.000Z' }), similarity: 0.9 }];
    expect(trimConversationQueryResults(rows).messages.map(({ content }) => content)).toEqual(['old', 'new']);
    expect(trimConversationQueryResults(rows, 1, (value) => value.includes('old') ? 2 : 1).messages.map(({ content }) => content)).toEqual(['new']);
    expect(estimateConservativeTokens('abc')).toBe(3); expect(estimateConservativeTokens('😀')).toBe(4);
  });

  test('delegates latest 50 completed prior messages to Core with current message separate', async () => {
    const prior = Array.from({ length: 55 }, (_, index) => message({ role: index % 2 ? 'ASSISTANT' : 'USER', content: `prior-${index}`, createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
    let startedUser: ConversationMessage | undefined; let request: any;
    const { repository } = repositoryMock({ beginTurn: async (_owner, _conversation, user, assistant) => { startedUser = user; return { state: 'created', user, assistant, first: false }; }, latestCompletedMessages: async () => [...prior, startedUser!] });
    await createConversationService({ repository, embed: async () => [1], core: async (input) => { request = input; return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'CURRENT', requestKey: 'history' }, context, () => {});
    expect(request.message).toBe('CURRENT'); expect(request.context).toHaveLength(50);
    expect(request.context.map((item: { content: string }) => item.content)).toEqual(prior.slice(-50).map(({ content }) => content));
    expect(JSON.stringify(request.context)).not.toContain('CURRENT');
  });

  test('keeps the newest recent context within the aggregate bound and orders a turn user-first', async () => {
    const large = Array.from({ length: 3 }, (_, index) => message({ role: index % 2 ? 'ASSISTANT' : 'USER', content: `${index}:${'x'.repeat(99_990)}`, createdAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString() }));
    let request: any; let startedAssistant: ConversationMessage | undefined;
    const { repository } = repositoryMock({
      beginTurn: async (_owner, _conversation, user, assistant) => { startedAssistant = assistant; return { state: 'created', user, assistant, first: false }; },
      latestCompletedMessages: async () => large,
    });
    await createConversationService({ repository, now: () => at, embed: async () => [1], core: async (input) => { request = input; return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'bounded-context' }, context, () => {});
    expect(request.context).toHaveLength(2);
    expect(request.context.map((item: { content: string }) => item.content[0])).toEqual(['1', '2']);
    expect(startedAssistant!.createdAt).toBe('2026-09-01T10:00:00.001Z');
  });

  test('streams Core deltas, applies first name, persists both embeddings, and preserves done SSE', async () => {
    const embeddings: unknown[] = []; const events: any[] = []; let savedName: string | undefined;
    const { repository } = repositoryMock({ first: true, completeTurn: async (_owner, _conversation, _key, content, embedding, _completed, name) => { savedName = name; return { message: message({ content, embedding }), nameApplied: true }; } });
    await createConversationService({
      repository, now: () => at, embed: async (input) => { embeddings.push(input); return [1]; },
      core: async (request, execution) => { expect(request).toMatchObject({ currentDate: at, generateName: true, requestKey: 'first' }); await execution.onDelta?.('Hello '); await execution.onDelta?.('there'); return { message: 'Hello there', name: 'Introductions', tools: [] }; },
    }).turn({ conversationKey, message: 'Hello', requestKey: 'first' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'delta', 'done']);
    expect(savedName).toBe('Introductions'); expect(embeddings.map((input: any) => input.text)).toEqual(['Hello', 'Hello there']);
  });

  test('keeps a completed agent answer successful when semantic indexing fails', async () => {
    const events: any[] = []; let completedEmbedding: number[] | undefined | null = null;
    const { repository, failed } = repositoryMock({
      setMessageEmbedding: async () => { throw new Error('user indexing unavailable'); },
      completeTurn: async (_owner, _conversation, _key, content, embedding, completedAt) => { completedEmbedding = embedding; return { message: message({ content, embedding, completedAt }), nameApplied: false }; },
    });
    await createConversationService({ repository, embed: async () => { throw new Error('indexing unavailable'); }, core: async (_request, execution) => { await execution.onDelta?.('answer'); return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'index-failure' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'done']);
    expect(completedEmbedding).toBeUndefined();
    expect(failed()).toBe(0);
  });

  test('replays idempotently and fails pending turns when Core fails', async () => {
    const replayEvents: any[] = [];
    await createConversationService({ repository: { beginTurn: async () => ({ state: 'replay', user: message({ role: 'USER' }), assistant: message({ content: 'Already done' }), first: false }) } as unknown as ConversationRepository }).turn({ conversationKey, message: 'again', requestKey: 'request-1' }, context, (event) => { replayEvents.push(event); });
    expect(replayEvents.at(-1)).toMatchObject({ type: 'done', replayed: true, message: { content: 'Already done' } });
    const { repository, failed } = repositoryMock();
    await expect(createConversationService({ repository, embed: async () => [1], core: async () => { throw new Error('agent failed'); } }).turn({ conversationKey, message: 'x', requestKey: 'failed' }, context, () => {})).rejects.toThrow('agent failed');
    expect(failed()).toBe(1);
  });

  test('records search history and paginates list/search/messages', async () => {
    let records = 0; const listInputs: unknown[] = []; const firstKey = newId();
    const rows = [{ key: firstKey, ...owner, name: 'First', isFavorite: true, createdAt: at, updatedAt: at }, { key: newId(), ...owner, name: 'Second', isFavorite: true, createdAt: at, updatedAt: '2026-08-31T10:00:00.000Z' }];
    const older = message({ createdAt: '2026-08-30T10:00:00.000Z' }), newer = message({ createdAt: '2026-08-31T10:00:00.000Z' });
    const repository = { list: async (_owner: unknown, input: unknown) => { listInputs.push(input); return rows; }, listMessages: async () => [older, newer] } as unknown as ConversationRepository;
    const service = createConversationService({ repository, userSearches: { record: async () => { records += 1; return {} as never; } } as never });
    const first = await service.list({ favoriteOnly: true, limit: 1 }, context);
    await service.search({ query: 'first', favoriteOnly: true, limit: 1, cursor: first.nextCursor, recordHistory: true }, context); await service.search({ query: 'private', recordHistory: false }, context);
    expect(records).toBe(1); expect(listInputs[1]).toMatchObject({ favoriteOnly: true, cursor: { key: firstKey } });
    const page = await service.messages({ conversationKey, limit: 1, cursor: encodeCursor({ createdAt: at, key: newId() }) }, context);
    expect(page.items[0]!.key).toBe(newer.key); expect(page.nextCursor).not.toBeNull();
    expect(conversationListInputSchema.parse({})).toEqual({ limit: 25, favoriteOnly: false }); expect(conversationSearchInputSchema.parse({ query: 'roadmap' })).toMatchObject({ recordHistory: true });
  });

  test('propagates AbortSignal through Core and both embeddings', async () => {
    const controller = new AbortController(); const signals: unknown[] = []; const { repository } = repositoryMock();
    await createConversationService({ repository, router: { signal: controller.signal }, core: async (_request, _context, deps) => { signals.push(deps?.router?.signal); return { message: 'answer', tools: [] }; }, embed: async ({ signal }) => { signals.push(signal); return [1]; } }).turn({ conversationKey, message: 'next', requestKey: 'signal' }, context, () => {});
    expect(signals).toEqual([controller.signal, controller.signal, controller.signal]);
  });
});
