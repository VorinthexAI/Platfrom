import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { BookRepositoryError } from '@/lib/books/repository';
import { createBookHandlers } from './books';
import { registerRoutes } from './routes';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runTool } from '@/lib/ai/tools';
import { SparkRepositoryError } from '@/lib/sparks/repository';

const billingFixture = {
  recordEvent: async () => {},
  billing: {
    charge: async (_userKey: string, input: Record<string, unknown>) => ({ status: 'applied' as const, transaction: { key: newId(), eventKey: input.eventKey } }) as never,
    refund: async () => ({ status: 'applied' as const, transaction: { key: newId() } }) as never,
  },
};
const toolDomain = (organizationKey: string, scopeKey: string, userKey: string) => ({ organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } }) as unknown as ToolContext;

describe('book HTTP handlers', () => {
  test('requires a user session and maps strict input failures', async () => {
    const service = { overview: async () => { throw new (await import('zod')).ZodError([]); } } as never;
    const unauthorized = new Hono(); unauthorized.post('/books/overview', createBookHandlers({ service, getIdentity: async () => null }).overview);
    expect((await unauthorized.request('/books/overview', { method: 'POST', body: '{}' })).status).toBe(401);
    const app = new Hono(); app.post('/books/overview', createBookHandlers({ service, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).overview);
    expect((await app.request('/books/overview', { method: 'POST', body: '{}' })).status).toBe(400);
  });

  test('registers all mobile book routes', async () => {
    const app = new Hono(); registerRoutes(app); const book = newId(); const chapter = newId();
    for (const [method, path] of [['POST', '/assistant/respond'], ['POST', '/books/overview'], ['POST', '/books/topic-suggestions'], ['POST', '/books/goal-suggestions'], ['POST', '/books'], ['POST', `/books/${book}/detail`], ['POST', `/books/${book}/extension/preview`], ['POST', `/books/${book}/extension`], ['POST', `/books/${book}/share/detail`], ['POST', `/books/${book}/share/update`], ['POST', `/books/${book}/retry`], ['POST', `/books/${book}/cancel`], ['POST', `/books/${book}/favorite`], ['DELETE', `/books/${book}`], ['PATCH', `/books/${book}/chapters/${chapter}/progress`]]) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    }
  });

  test('keeps POST /books as a thin call to BookService.create', async () => {
    const userKey = newId();
    const body = { organizationKey: 'organization', scopeKey: newId(), generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
    const calls: unknown[][] = [];
    const app = new Hono();
    app.post('/books', createBookHandlers({ ...billingFixture, service: { create: async (...args: unknown[]) => { calls.push(args); return { key: newId() }; } } as never, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context: toolDomain(body.organizationKey, body.scopeKey, userKey) }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(202);
    expect(calls).toEqual([[body, userKey]]);
  });

  test('HTTP and Core share book acceptance debits and insufficient-balance behavior', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId();
    const body = { organizationKey, scopeKey, generationRequestKey: 'http-book', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
    const modelInput = { topic: body.topic, goal: body.goal, currentKnowledge: body.currentKnowledge, writingTone: body.writingTone, language: body.language, archiveDocumentKeys: body.archiveDocumentKeys, narratorVoiceKey: body.narratorVoiceKey, narrationPace: body.narrationPace };
    const context = toolDomain(organizationKey, scopeKey, userKey);
    const charges: Record<string, unknown>[] = [];
    const service = { create: async () => ({ key: newId(), status: 'queued' }) } as never;
    const billing = { charge: async (_key: string, input: Record<string, unknown>) => { charges.push(input); return { status: 'applied', transaction: { key: newId(), eventKey: input.eventKey } } as never; } };
    await runTool('book.create', '', modelInput, { contentContext: context, bookService: service, requestKey: 'core-book', recordEvent: async () => {}, billing });
    const app = new Hono().post('/books', createBookHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context }), recordEvent: async () => {}, billing }).create);
    expect((await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(202);
    expect(charges).toHaveLength(2);
    expect(charges.every((charge) => charge.toolSlug === 'book.create' && charge.microSparks === 100_000_000)).toBe(true);
    expect(charges.every((charge) => (charge.metadata as { paidOutcome?: string }).paidOutcome === 'queue-accepted')).toBe(true);

    const insufficientBilling = { charge: async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); } };
    await expect(runTool('book.create', '', modelInput, { contentContext: context, bookService: service, requestKey: 'core-insufficient', recordEvent: async () => {}, billing: insufficientBilling })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    const insufficient = new Hono().post('/books', createBookHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context }), recordEvent: async () => {}, billing: insufficientBilling }).create);
    expect((await insufficient.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, generationRequestKey: 'http-insufficient' }) })).status).toBe(402);
  });

  test('keeps topic suggestion HTTP and Core callers on the same canonical service method', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const calls: unknown[][] = [];
    const service = { suggestTopics: async (...args: unknown[]) => { calls.push(args); return { topics: Array.from({ length: 10 }, (_, index) => `Topic ${index + 1}`) }; } } as never;
    const handlers = createBookHandlers({ ...billingFixture, service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context: toolDomain(organizationKey, scopeKey, userKey) }) });
    const app = new Hono(); app.post('/books/topic-suggestions', handlers.topicSuggestions);
    const body = { organizationKey, scopeKey, excludeTopics: ['Old idea'] };
    expect((await app.request('/books/topic-suggestions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.topic.suggest')!;
    await capability.execute({ excludeTopics: ['Old idea'] }, { domain, books: service } as any);
    expect(calls[0]).toEqual([body, userKey, { signal: expect.any(AbortSignal), timeoutMs: 45_000 }]);
    expect(calls[1]).toEqual([body, userKey, { signal: undefined, timeoutMs: undefined }]);
  });

  test('keeps goal suggestion HTTP and Core callers on the same canonical service method', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const calls: unknown[][] = [];
    const service = { suggestGoals: async (...args: unknown[]) => { calls.push(args); return { goals: Array.from({ length: 10 }, (_, index) => `Goal ${index + 1}`) }; } } as never;
    const handlers = createBookHandlers({ ...billingFixture, service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context: toolDomain(organizationKey, scopeKey, userKey) }) });
    const app = new Hono(); app.post('/books/goal-suggestions', handlers.goalSuggestions);
    const body = { organizationKey, scopeKey, topic: 'Decision making', excludeGoals: ['Old goal'] };
    expect((await app.request('/books/goal-suggestions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.goal.suggest')!;
    await capability.execute({ topic: 'Decision making', excludeGoals: ['Old goal'] }, { domain, books: service } as any);
    expect(calls[0]).toEqual([body, userKey, { signal: expect.any(AbortSignal), timeoutMs: 45_000 }]);
    expect(calls[1]).toEqual([body, userKey, { signal: undefined, timeoutMs: undefined }]);
  });

  test('maps generation request key conflicts to HTTP 409', async () => {
    const userKey = newId();
    const body = { organizationKey: 'organization', scopeKey: newId(), generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
    const app = new Hono();
    app.post('/books', createBookHandlers({ ...billingFixture, service: { create: async () => { throw new BookRepositoryError('conflict', 'Generation request key was reused with a different brief.'); } } as never, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context: toolDomain(body.organizationKey, body.scopeKey, userKey) }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'BOOK_CONFLICT' } });
  });

  test('keeps strict favorite HTTP and Core callers on the same canonical service method', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const calls: unknown[][] = [];
    const service = { setFavorite: async (...args: unknown[]) => { calls.push(args); return { key: bookKey, isFavorite: true }; } } as never;
    const app = new Hono(); app.post('/books/:bookKey/favorite', createBookHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).setFavorite);
    const body = { organizationKey, scopeKey, isFavorite: true };
    expect((await app.request(`/books/${bookKey}/favorite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, userKey }) })).status).toBe(400);
    expect((await app.request(`/books/${bookKey}/favorite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.favorite')!;
    await expect(capability.execute({ bookKey, isFavorite: false, scopeKey }, { domain, books: service } as any)).rejects.toThrow('Unrecognized key');
    await capability.execute({ bookKey, isFavorite: true }, { domain, books: service } as any);
    expect(calls).toEqual([[bookKey, body, userKey], [bookKey, body, userKey]]);
    expect(capability.mutationWorkspace).toBe('ascend');
  });

  test('keeps extension HTTP and Core callers on the canonical service with trusted context and request key injection', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const calls: unknown[][] = [];
    const service: any = { extend: async (...args: unknown[]) => { calls.push(args); return args[1] && (args[1] as any).mode === 'preview' ? { titles: ['Next'] } : { key: bookKey }; } };
    const handlers = createBookHandlers({ ...billingFixture, service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context: toolDomain(organizationKey, scopeKey, userKey) }) }); const app = new Hono(); app.post('/books/:bookKey/extension/preview', handlers.extensionPreview); app.post('/books/:bookKey/extension', handlers.extensionGenerate);
    const context = { organizationKey, scopeKey };
    expect((await app.request(`/books/${bookKey}/extension/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, chapterCount: 1 }) })).status).toBe(200);
    expect((await app.request(`/books/${bookKey}/extension`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, chapterCount: 1, titles: ['Next'], requestKey: 'http-request' }) })).status).toBe(202);
    const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.extend')!;
    await expect(capability.execute({ mode: 'generate', bookKey, chapterCount: 1, titles: ['Next'], userKey }, { domain, books: service, requestKey: 'core-request' } as any)).rejects.toThrow('Unrecognized key');
    await capability.execute({ mode: 'preview', bookKey, chapterCount: 1 }, { domain, books: service } as any); await capability.execute({ mode: 'generate', bookKey, chapterCount: 1, titles: ['Next'] }, { domain, books: service, requestKey: 'core-request' } as any);
    expect(calls[0]?.slice(0, 3)).toEqual([bookKey, { ...context, chapterCount: 1, mode: 'preview' }, userKey]);
    expect(calls[1]?.slice(0, 3)).toEqual([bookKey, { ...context, chapterCount: 1, titles: ['Next'], requestKey: 'http-request', mode: 'generate' }, userKey]);
    expect(calls[2]?.slice(0, 3)).toEqual([bookKey, { ...context, mode: 'preview', chapterCount: 1 }, userKey]);
    expect(calls[3]?.slice(0, 3)).toEqual([bookKey, { ...context, mode: 'generate', chapterCount: 1, titles: ['Next'], requestKey: 'core-request' }, userKey]);
    expect(capability.mutationWorkspace).toBeInstanceOf(Function); expect((capability.mutationWorkspace as any)({ mode: 'preview' })).toBeUndefined(); expect((capability.mutationWorkspace as any)({ mode: 'generate' })).toBe('ascend');
  });

  test('keeps strict share HTTP and Core callers on canonical methods while Core redacts the URL', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const calls: unknown[][] = []; const url = `https://vorinthex.com/share/books/${'A'.repeat(43)}`;
    const service: any = { shareDetail: async (...args: unknown[]) => { calls.push(['detail', ...args]); return { key: newId(), url, active: false, createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z' }; }, setShareActive: async (...args: unknown[]) => { calls.push(['update', ...args]); return { key: newId(), url, active: true, createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z' }; } };
    const handlers = createBookHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }); const app = new Hono(); app.post('/books/:bookKey/share/detail', handlers.shareDetail); app.post('/books/:bookKey/share/update', handlers.shareUpdate);
    expect((await app.request(`/books/${bookKey}/share/detail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, forged: true }) })).status).toBe(400);
    const response = await app.request(`/books/${bookKey}/share/detail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) }); expect(JSON.stringify(await response.json())).toContain(url);
    const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const detail = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.share.detail')!; const update = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.share.update')!;
    expect(JSON.stringify(await detail.execute({ bookKey }, { domain, books: service } as any))).not.toContain(url);
    expect(JSON.stringify(await update.execute({ bookKey, active: true }, { domain, books: service } as any))).not.toContain(url);
    expect(update.mutationWorkspace).toBe('ascend');
    expect(calls).toEqual([['detail', bookKey, { organizationKey, scopeKey }, userKey], ['detail', bookKey, { organizationKey, scopeKey }, userKey], ['update', bookKey, { organizationKey, scopeKey, active: true }, userKey]]);
  });

  test('maps favorite deletion to a stable conflict', async () => {
    const bookKey = newId(); const app = new Hono();
    app.delete('/books/:bookKey', createBookHandlers({ service: { delete: async () => { throw new BookRepositoryError('favorite', 'Unfavorite the audio book before deleting it.'); } } as never, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).delete);
    const response = await app.request(`/books/${bookKey}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'BOOK_FAVORITE', message: 'Unfavorite the audio book before deleting it.' } });
  });

  test('keeps HTTP and Core retry, cancel, and delete on the same authorized service methods', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const calls: unknown[][] = [];
    const service: any = Object.fromEntries(['retry', 'cancel', 'delete'].map((method) => [method, async (...args: unknown[]) => { calls.push([method, ...args]); return { key: bookKey }; }]));
    const handlers = createBookHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }); const app = new Hono(); app.post('/books/:bookKey/retry', handlers.retry); app.post('/books/:bookKey/cancel', handlers.cancel); app.delete('/books/:bookKey', handlers.delete);
    const serviceContext = { organizationKey, scopeKey }; const domain = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    for (const [method, httpMethod, suffix, capabilityName, expectedStatus] of [['retry', 'POST', 'retry', 'book.generation.retry', 202], ['cancel', 'POST', 'cancel', 'book.generation.cancel', 200], ['delete', 'DELETE', '', 'book.delete', 200]] as const) {
      const path = `/books/${bookKey}${suffix ? `/${suffix}` : ''}`; expect((await app.request(path, { method: httpMethod, headers: { 'content-type': 'application/json' }, body: JSON.stringify(serviceContext) })).status).toBe(expectedStatus);
      const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === capabilityName)!; await capability.execute({ bookKey }, { domain, books: service } as any);
      expect(calls.splice(0)).toEqual([[method, bookKey, serviceContext, userKey], [method, bookKey, serviceContext, userKey]]);
    }
  });

  test('rejects non-user HTTP and inactive Core lifecycle callers before service execution', async () => {
    const bookKey = newId(); let calls = 0; const service: any = { retry: async () => { calls += 1; } };
    const app = new Hono(); app.post('/books/:bookKey/retry', createBookHandlers({ service, getIdentity: async () => ({ key: newId(), identityType: 'member' }) }).retry);
    expect((await app.request(`/books/${bookKey}/retry`, { method: 'POST', body: '{}' })).status).toBe(403);
    const organizationKey = newId(); const userKey = newId(); const domain = { organizationKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'inactive' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.generation.retry')!;
    await expect(capability.execute({ bookKey }, { domain, books: service } as any)).rejects.toThrow('Active matching'); expect(calls).toBe(0);
  });
});
