import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { BookRepositoryError } from '@/lib/books/repository';
import { createBookHandlers } from './books';
import { registerRoutes } from './routes';

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
    for (const [method, path] of [['POST', '/books/overview'], ['POST', '/books'], ['POST', `/books/${book}/detail`], ['PATCH', `/books/${book}/chapters/${chapter}/progress`]]) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    }
  });

  test('keeps POST /books as a thin call to BookService.create', async () => {
    const userKey = newId();
    const body = { organizationKey: 'organization', scopeKey: newId(), generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' };
    const calls: unknown[][] = [];
    const app = new Hono();
    app.post('/books', createBookHandlers({ service: { create: async (...args: unknown[]) => { calls.push(args); return { key: newId() }; } } as never, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    expect(calls).toEqual([[body, userKey]]);
  });

  test('maps generation request key conflicts to HTTP 409', async () => {
    const app = new Hono();
    app.post('/books', createBookHandlers({ service: { create: async () => { throw new BookRepositoryError('conflict', 'Generation request key was reused with a different brief.'); } } as never, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).create);
    const response = await app.request('/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'BOOK_CONFLICT' } });
  });
});
