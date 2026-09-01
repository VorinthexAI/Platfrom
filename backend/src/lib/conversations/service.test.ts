import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import { createConversationService, estimateConservativeTokens, trimConversationQueryResults } from './service';
import { assistantQueryInputSchema, conversationListInputSchema, conversationModelSendInputSchema, conversationSearchInputSchema, conversationSendInputSchema, projectConversationMessage, type ConversationMessage } from './schemas';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), membershipKey = newId(), conversationKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const at = '2026-09-01T10:00:00.000Z';
const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({ key: newId(), conversationKey, organizationKey, scopeKey, userKey, turnKey: 'request-1', requestHash: 'a'.repeat(64), role: 'ASSISTANT', status: 'COMPLETED', content: 'answer', createdAt: at, completedAt: at, ...overrides });

describe('private conversations', () => {
  test('keeps model and safe projections strict', () => {
    expect(assistantQueryInputSchema.parse({ query: 'What did we decide?' })).toEqual({ query: 'What did we decide?', limit: 50 });
    expect(conversationListInputSchema.parse({})).toEqual({ limit: 25, favoriteOnly: false });
    expect(conversationSearchInputSchema.parse({ query: 'roadmap' })).toEqual({ query: 'roadmap', limit: 25, favoriteOnly: false, recordHistory: true });
    expect(conversationListInputSchema.parse({ favoriteOnly: true })).toMatchObject({ favoriteOnly: true });
    expect(() => conversationListInputSchema.parse({ favoriteOnly: 'true' })).toThrow();
    for (const forged of ['conversationKey', 'organizationKey', 'scopeKey', 'userKey']) expect(() => assistantQueryInputSchema.parse({ query: 'x', [forged]: newId() })).toThrow('Unrecognized key');
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'r', extra: true })).toThrow('Unrecognized key');
    expect(() => conversationModelSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'model-forged' })).toThrow('Unrecognized key');
    expect(projectConversationMessage(message())).not.toHaveProperty('embedding');
  });

  test('orders semantic results chronologically and removes oldest until within 10k tokens', () => {
    const rows = [
      { message: message({ key: newId(), content: 'old', createdAt: '2026-01-01T00:00:00.000Z' }), similarity: 0.8 },
      { message: message({ key: newId(), content: 'new', createdAt: '2026-02-01T00:00:00.000Z' }), similarity: 0.9 },
    ];
    expect(trimConversationQueryResults(rows).messages.map(({ content }) => content)).toEqual(['old', 'new']);
    expect(trimConversationQueryResults(rows, 1, (text) => text.includes('old') ? 2 : 1).messages.map(({ content }) => content)).toEqual(['new']);
    expect(estimateConservativeTokens('abc')).toBe(3);
    expect(estimateConservativeTokens('😀')).toBe(4);
    const boundary = JSON.stringify({ messages: [{ key: rows[1]!.message.key, content: 'new', createdAt: rows[1]!.message.createdAt, similarity: 0.9 }] });
    expect(trimConversationQueryResults([rows[1]!], estimateConservativeTokens(boundary)).messages).toHaveLength(1);
    expect(trimConversationQueryResults([rows[1]!], estimateConservativeTokens(boundary) - 1).messages).toHaveLength(0);
  });

  test('answers a first general question without query embedding or retrieval and persists its name', async () => {
    let semantic = 0, embeds = 0, savedName: string | undefined;
    const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined });
    const repository: any = {
      beginTurn: async () => ({ state: 'created', user: message({ role: 'USER', content: 'Hello' }), assistant: pending, first: true }),
      semanticMessages: async () => { semantic += 1; return []; },
      completeTurn: async (_owner: unknown, _conversation: string, _key: string, content: string, embedding: number[], _completed: string, name?: string) => { savedName = name; return { message: message({ key: pending.key, content, embedding }), nameApplied: true }; },
      failTurn: async () => {},
    };
    const events: any[] = [];
    await createConversationService({ repository, id: newId, now: () => at, embed: async () => { embeds += 1; return [1]; }, execute: async (_org, input) => { expect(input.tools?.map(({ name }) => name)).toEqual(['assistant.query']); return { output: { text: '{"name":"Introductions","response":"Hello there."}', toolCalls: [], stopReason: 'stop' } } as any; } }).turn({ conversationKey, message: 'Hello', requestKey: 'request-1' }, context, (event) => { events.push(event); });
    expect({ semantic, embeds, savedName }).toEqual({ semantic: 0, embeds: 1, savedName: 'Introductions' });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'done']);
  });

  test('executes assistant.query only when selected and injects the current owner and conversation', async () => {
    let calls = 0; let semanticOwner: unknown; let semanticConversation: string | undefined;
    const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined });
    const repository: any = {
      beginTurn: async () => ({ state: 'created', user: message({ role: 'USER' }), assistant: pending, first: true }), read: async () => ({ key: conversationKey }), failTurn: async () => {},
      semanticMessages: async (owner: unknown, selected: string) => { semanticOwner = owner; semanticConversation = selected; return [{ message: message({ content: 'Prior answer' }), similarity: 0.9 }]; },
      completeTurn: async (_owner: unknown, _conversation: string, _key: string, content: string, embedding: number[]) => ({ message: message({ key: pending.key, content, embedding }), nameApplied: true }),
    };
    await createConversationService({ repository, embed: async () => [1], execute: async (_org, input) => {
      calls += 1;
      if (calls === 1) return { output: { text: '', toolCalls: [{ id: 'query-1', name: 'assistant.query', arguments: { query: 'prior decision', limit: 50 } }], stopReason: 'tool_use' } } as any;
      expect(input.messages.at(-1)?.role).toBe('tool');
      return { output: { text: '{"name":"Decision","response":"The prior decision stands."}', toolCalls: [], stopReason: 'stop' } } as any;
    } }).turn({ conversationKey, message: 'What did we decide?', requestKey: 'request-1' }, context, () => {});
    expect(calls).toBe(2); expect(semanticConversation).toBe(conversationKey); expect(semanticOwner).toEqual({ organizationKey, scopeKey, userKey });
  });

  test('streams later direct answers and replays completed idempotent turns', async () => {
    const completed = message({ content: 'Already done' }); let streamed = 0;
    const replayRepository: any = { beginTurn: async () => ({ state: 'replay', user: message({ role: 'USER' }), assistant: completed, first: false }) };
    const replayEvents: any[] = [];
    await createConversationService({ repository: replayRepository }).turn({ conversationKey, message: 'again', requestKey: 'request-1' }, context, (event) => { replayEvents.push(event); });
    expect(replayEvents.at(-1)).toMatchObject({ type: 'done', replayed: true, message: { content: 'Already done' } });

    const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined });
    const repository: any = { beginTurn: async () => ({ state: 'created', user: message({ role: 'USER' }), assistant: pending, first: false }), failTurn: async () => {}, completeTurn: async (_o: unknown, _c: string, _k: string, content: string, embedding: number[]) => ({ message: message({ key: pending.key, content, embedding }), nameApplied: false }) };
    const events: any[] = [];
    await createConversationService({ repository, embed: async () => [1], stream: async function* () { streamed += 1; yield { type: 'text-delta', text: 'Live ' }; yield { type: 'text-delta', text: 'answer' }; yield { type: 'done' }; } }).turn({ conversationKey, message: 'next', requestKey: 'request-2' }, context, (event) => { events.push(event); });
    expect(streamed).toBe(1); expect(events.filter(({ type }) => type === 'delta').map(({ text }) => text)).toEqual(['Live ', 'answer']);
  });

  test('emits the first direct delta before provider generation completes', async () => {
    const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository: any = { beginTurn: async () => ({ state: 'created', user: message({ role: 'USER' }), assistant: pending, first: false }), failTurn: async () => {}, completeTurn: async (_o: unknown, _c: string, _k: string, content: string, embedding: number[]) => ({ message: message({ key: pending.key, content, embedding }), nameApplied: false }) };
    let firstDelta!: () => void; const emitted = new Promise<void>((resolve) => { firstDelta = resolve; });
    const turn = createConversationService({ repository, embed: async () => [1], stream: async function* () { yield { type: 'text-delta', text: 'Immediate' }; await gate; yield { type: 'text-delta', text: ' finish' }; yield { type: 'done' }; } }).turn({ conversationKey, message: 'next', requestKey: 'stream-now' }, context, (event) => { if (event.type === 'delta') firstDelta(); });
    await emitted; let completed = false; void turn.then(() => { completed = true; }); await Promise.resolve(); expect(completed).toBe(false); release(); await turn;
  });

  test('rejects mixed visible text and tool calls without replaying text', async () => {
    const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); let failed = 0;
    const repository: any = { beginTurn: async () => ({ state: 'created', user: message({ role: 'USER' }), assistant: pending, first: false }), failTurn: async () => { failed += 1; } };
    const deltas: string[] = [];
    await expect(createConversationService({ repository, stream: async function* () { yield { type: 'text-delta', text: 'partial' }; yield { type: 'tool-call', toolCall: { id: 'q', name: 'assistant.query', arguments: { query: 'x' } } }; yield { type: 'done' }; } }).turn({ conversationKey, message: 'next', requestKey: 'mixed' }, context, (event) => { if (event.type === 'delta') deltas.push(event.text); })).rejects.toThrow('mixed visible text');
    expect(deltas).toEqual(['partial']); expect(failed).toBe(1);
  });

  test('authorizes retrieval before embedding and records conversation search history only when enabled', async () => {
    let embeds = 0, records = 0;
    const missing: any = { read: async () => null };
    await expect(createConversationService({ repository: missing, embed: async () => { embeds += 1; return [1]; } }).query(context, conversationKey, { query: 'secret' })).rejects.toThrow('not found');
    expect(embeds).toBe(0);
    const repository: any = { list: async () => [] };
    const service = createConversationService({ repository, userSearches: { record: async () => { records += 1; return {} as never; } } as never });
    await service.search({ query: 'roadmap', recordHistory: true }, context); await service.search({ query: 'private', recordHistory: false }, context);
    expect(records).toBe(1);
  });

  test('passes favorite-only through list and search cursor pagination', async () => {
    const seen: any[] = [], firstKey = newId(), secondKey = newId();
    const rows = [
      { key: firstKey, organizationKey, scopeKey, userKey, name: 'First', isFavorite: true, createdAt: at, updatedAt: at },
      { key: secondKey, organizationKey, scopeKey, userKey, name: 'Second', isFavorite: true, createdAt: at, updatedAt: '2026-08-31T10:00:00.000Z' },
    ];
    const repository: any = { list: async (_owner: unknown, input: unknown) => { seen.push(input); return rows; } };
    const service = createConversationService({ repository, userSearches: { record: async () => ({} as never) } as never });
    const first = await service.list({ favoriteOnly: true, limit: 1 }, context);
    expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    await service.search({ query: 'first', favoriteOnly: true, limit: 1, cursor: first.nextCursor, recordHistory: false }, context);
    expect(seen[0]).toMatchObject({ favoriteOnly: true, limit: 2, cursor: undefined });
    expect(seen[1]).toMatchObject({ query: 'first', favoriteOnly: true, limit: 2, cursor: { favorite: true, updatedAt: at, key: firstKey } });
  });

  test('binds an idempotency key to the normalized payload and returns deterministic conflicts', async () => {
    const requestHashes: string[] = [];
    const conflictRepository: any = { beginTurn: async (_owner: unknown, _conversation: string, user: ConversationMessage) => { requestHashes.push(user.requestHash); return { state: 'idempotency-conflict' }; } };
    const service = createConversationService({ repository: conflictRepository });
    await expect(service.turn({ conversationKey, message: '  Same payload  ', requestKey: 'same-key' }, context, () => {})).rejects.toThrow('different message');
    await expect(service.turn({ conversationKey, message: 'different payload', requestKey: 'same-key' }, context, () => {})).rejects.toThrow('different message');
    expect(requestHashes[0]).toMatch(/^[a-f0-9]{64}$/); expect(requestHashes[0]).not.toBe(requestHashes[1]);
  });

  test('propagates the turn AbortSignal through provider streaming and output embedding', async () => {
    const controller = new AbortController(), pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); const signals: AbortSignal[] = [];
    const repository: any = { beginTurn: async () => ({ state: 'created', user: message({ role: 'USER' }), assistant: pending, first: false }), failTurn: async () => {}, completeTurn: async (_o: unknown, _c: string, _k: string, content: string, embedding: number[]) => ({ message: message({ key: pending.key, content, embedding }), nameApplied: false }) };
    await createConversationService({ repository, router: { signal: controller.signal }, stream: async function* (_org, _input, options) { signals.push(options?.signal!); yield { type: 'text-delta', text: 'answer' }; yield { type: 'done' }; }, embed: async ({ signal }) => { signals.push(signal!); return [1]; } }).turn({ conversationKey, message: 'next', requestKey: 'signal' }, context, () => {});
    expect(signals).toEqual([controller.signal, controller.signal]);
  });
});
