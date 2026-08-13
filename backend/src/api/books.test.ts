import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
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
});
