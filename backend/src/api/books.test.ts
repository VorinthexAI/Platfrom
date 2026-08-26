import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { BookRepositoryError } from '@/lib/books/repository';
import { createBookHandlers } from './books';
import { registerRoutes } from './routes';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

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
    for (const [method, path] of [['POST', '/assistant/respond'], ['POST', '/books/overview'], ['POST', '/books'], ['POST', `/books/${book}/detail`], ['POST', `/books/${book}/retry`], ['POST', `/books/${book}/cancel`], ['DELETE', `/books/${book}`], ['PATCH', `/books/${book}/chapters/${chapter}/progress`]]) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    }
  });

  test('keeps POST /books as a thin call to BookService.create', async () => {
    const userKey = newId();
    const body = { organizationKey: 'organization', scopeKey: newId(), generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', chapterCount: 10, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1, chapterImages: false };
    const calls: unknown[][] = [];
    const app = new Hono();
    app.post('/books', createBookHandlers({ service: { create: async (...args: unknown[]) => { calls.push(args); return { key: newId() }; } } as never, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(202);
    expect(calls).toEqual([[body, userKey]]);
  });

  test('maps generation request key conflicts to HTTP 409', async () => {
    const app = new Hono();
    app.post('/books', createBookHandlers({ service: { create: async () => { throw new BookRepositoryError('conflict', 'Generation request key was reused with a different brief.'); } } as never, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'BOOK_CONFLICT' } });
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
