import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { bindConversationStreamAbort, conversationDeltaEventSchema, conversationDoneEventSchema, conversationErrorEventSchema, conversationStartEventSchema, createConversationHandlers } from './conversations';
import type { ToolContext } from '@/lib/ai/tools';
import { SparkRepositoryError } from '@/lib/sparks/repository';

describe('conversation HTTP contract', () => {
  test('uses strict correlated SSE payloads and safe message projections', () => {
    const correlationKey = newId(), conversationKey = newId(), userMessageKey = newId(), assistantMessageKey = newId();
    expect(conversationStartEventSchema.parse({ type: 'start', correlationKey, conversationKey, userMessageKey, assistantMessageKey })).toHaveProperty('correlationKey', correlationKey);
    expect(conversationDeltaEventSchema.parse({ type: 'delta', correlationKey, assistantMessageKey, text: 'hello' })).toHaveProperty('text', 'hello');
    const message = { key: assistantMessageKey, conversationKey, turnKey: 'request', role: 'ASSISTANT', status: 'COMPLETED', content: 'hello', createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:00:01.000Z' };
    expect(conversationDoneEventSchema.parse({ type: 'done', correlationKey, conversationKey, message, replayed: false })).toMatchObject({ message: { content: 'hello', retrievals: [] } });
    const retrieval = { query: 'roadmap', limit: 3, minimumScore: 0.55, groups: [{ collectionSlug: 'documents', results: [{ key: newId(), label: 'Roadmap' }] }] };
    expect(conversationDoneEventSchema.parse({ type: 'done', correlationKey, conversationKey, message: { ...message, retrievals: [retrieval] }, replayed: false })).toHaveProperty('message.retrievals', [retrieval]);
    expect(() => conversationDoneEventSchema.parse({ type: 'done', correlationKey, conversationKey, message: { ...message, retrievals: [{ ...retrieval, rawOutput: true }] }, replayed: false })).toThrow('Unrecognized key');
    expect(conversationErrorEventSchema.parse({ type: 'error', correlationKey, code: 'FAILED', message: 'failed' })).toHaveProperty('code', 'FAILED');
    expect(() => conversationDoneEventSchema.parse({ type: 'done', correlationKey, conversationKey, message: { ...message, userKey: newId() }, replayed: false })).toThrow('Unrecognized key');
    expect(() => conversationDeltaEventSchema.parse({ type: 'delta', correlationKey, assistantMessageKey, text: 'hello', secret: true })).toThrow('Unrecognized key');
  });

  test('binds stream cancellation to an AbortSignal and disables later writes', () => {
    let abortStream!: () => void; const request = new AbortController();
    const bound = bindConversationStreamAbort({ onAbort(callback) { abortStream = callback; } }, request.signal);
    expect(bound.active()).toBe(true); abortStream(); expect(bound.signal.aborted).toBe(true); expect(bound.active()).toBe(false);
    const secondRequest = new AbortController(); const second = bindConversationStreamAbort({ onAbort() {} }, secondRequest.signal);
    secondRequest.abort(); expect(second.signal.aborted).toBe(true); expect(second.active()).toBe(false); second.dispose();
  });

  test('registers CRUD, pagination, and turn-scoped streaming separately from invalidation SSE', async () => {
    const routes = await Bun.file(new URL('./routes.ts', import.meta.url)).text();
    for (const route of ['/conversations', '/conversations/list', '/conversations/search', '/conversations/:conversationKey/messages/list', '/conversations/:conversationKey/messages/:messageKey', '/conversations/:conversationKey/turn/stream']) expect(routes).toContain(route);
    expect(routes).toContain("app.get('/events/stream', streamEvents)");
    expect(routes).toContain("app.post('/conversations/:conversationKey/turn/stream', conversationHandlers.turn)");
  });

  test('enforces HTTP authentication, strict transport input, and canonical service parity', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const unauthorized = new Hono(); unauthorized.post('/conversations', createConversationHandlers({ getIdentity: async () => null }).create);
    expect((await unauthorized.request('/conversations', { method: 'POST', body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(401);

    const calls: unknown[] = []; const published: unknown[] = [];
    const handlers = createConversationHandlers({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service: { create: async (input: unknown, selected: ToolContext) => { calls.push({ input, selected }); return { key: newId() }; }, list: async (input: unknown, selected: ToolContext) => { calls.push({ input, selected }); return { items: [], nextCursor: null }; } } as any,
      publishChanged: async (...args: unknown[]) => { published.push(args); },
    });
    const app = new Hono(); app.post('/conversations', handlers.create); app.post('/conversations/list', handlers.list);
    const invalid = await app.request('/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, unexpected: true }) });
    expect(invalid.status).toBe(400); expect(calls).toHaveLength(0);
    const response = await app.request('/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, name: 'Private' }) });
    expect(response.status).toBe(200); expect(calls).toEqual([{ input: { name: 'Private' }, selected: context }]); expect(published).toEqual([[userKey, 'conversation.changed']]);
    const list = await app.request('/conversations/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, favoriteOnly: true, limit: 10 }) });
    expect(list.status).toBe(200); expect(calls.at(-1)).toEqual({ input: { favoriteOnly: true, limit: 10 }, selected: context });
  });

  test('deletes a message turn through the canonical service and publishes invalidation', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), conversationKey = newId(), messageKey = newId(); const calls: unknown[] = []; const published: unknown[] = [];
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const handlers = createConversationHandlers({ getIdentity: async () => ({ identityType: 'user', key: userKey }) as never, authorize: async () => ({ context }), service: { deleteMessage: async (...args: unknown[]) => { calls.push(args); return { deletedKeys: [messageKey] }; } } as any, publishChanged: async (...args: unknown[]) => { published.push(args); } });
    const app = new Hono(); app.delete('/conversations/:conversationKey/messages/:messageKey', handlers.deleteMessage);
    const response = await app.request(`/conversations/${conversationKey}/messages/${messageKey}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, data: { deletedKeys: [messageKey] } });
    expect(calls).toEqual([[{ conversationKey, messageKey }, context]]); expect(published).toEqual([[userKey, 'conversation.changed']]);
    expect((await app.request(`/conversations/${conversationKey}/messages/${messageKey}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, userKey }) })).status).toBe(400);
  });

  test('strictly enqueues an image turn through the canonical service and returns accepted', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), conversationKey = newId(); const calls: unknown[] = []; const published: unknown[] = [];
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const handlers = createConversationHandlers({ getIdentity: async () => ({ identityType: 'user', key: userKey }) as never, authorize: async () => ({ context }), service: { enqueueImageTurn: async (...args: unknown[]) => { calls.push(args); return { queued: true }; } } as any, publishChanged: async (...args: unknown[]) => { published.push(args); } });
    const app = new Hono(); app.post('/conversations/:conversationKey/image-turns', handlers.imageTurn);
    const body = { organizationKey, scopeKey, prompt: 'A moonlit harbor', requestKey: 'image-request' };
    const response = await app.request(`/conversations/${conversationKey}/image-turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(202);
    expect(calls).toEqual([[{ conversationKey, prompt: body.prompt, requestKey: body.requestKey, referenceImageKeys: [], size: '1024x1024', quality: 'medium', mode: 'default' }, context]]);
    expect(published).toEqual([[userKey, 'conversation.changed']]);
    expect((await app.request(`/conversations/${conversationKey}/image-turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, count: 2 }) })).status).toBe(400);
  });

  test('does not emit a second terminal SSE event when change publication fails after done', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), conversationKey = newId(), correlationKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const handlers = createConversationHandlers({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      createTurnService: () => ({ turn: async (_input: unknown, _context: ToolContext, onEvent: (event: unknown) => Promise<void>) => onEvent({ type: 'done', correlationKey, conversationKey, message: { key: newId(), conversationKey, turnKey: 'request', role: 'ASSISTANT', status: 'COMPLETED', content: 'answer', retrievals: [], createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:00:01.000Z' }, replayed: false }) }) as never,
      publishChanged: async () => { throw new Error('unavailable'); },
    });
    const app = new Hono(); app.post('/conversations/:conversationKey/turn/stream', handlers.turn);
    const response = await app.request(`/conversations/${conversationKey}/turn/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, message: 'Find it', requestKey: 'request' }) });
    const stream = await response.text();
    expect(stream).toContain('event: done');
    expect(stream).not.toContain('event: error');
  });

  test('preserves insufficient balance in JSON and turn SSE boundaries', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), conversationKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const insufficient = () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); };
    const handlers = createConversationHandlers({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      service: { list: async () => insufficient() } as never,
      createTurnService: () => ({ turn: async () => insufficient() }) as never,
    });
    const app = new Hono();
    app.post('/conversations/list', handlers.list);
    app.post('/conversations/:conversationKey/turn/stream', handlers.turn);
    const json = await app.request('/conversations/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) });
    expect(json.status).toBe(402);
    expect(await json.json()).toEqual({ success: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'billing.insufficientBalance', details: null } });
    const stream = await app.request(`/conversations/${conversationKey}/turn/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, message: 'hello', requestKey: 'request' }) });
    expect(await stream.text()).toContain(JSON.stringify({ type: 'error', correlationKey: 'request', code: 'INSUFFICIENT_BALANCE', message: 'billing.insufficientBalance' }));
  });
});
