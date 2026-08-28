import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { BookRepositoryError } from '@/lib/books/repository';
import { createPublicBookShareHandlers } from './public-book-shares';

const token = 'A'.repeat(43);

describe('public book share protocol', () => {
  test('strictly reads through token authentication with no-store responses', async () => {
    const service: any = { readPublicShare: async () => ({ book: { key: 'safe' }, chapters: [] }) };
    const app = new Hono(); app.post('/public/books/shares/read', createPublicBookShareHandlers({ service }).read);
    const invalid = await app.request('/public/books/shares/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, forged: true }) });
    expect(invalid.status).toBe(400); expect(invalid.headers.get('cache-control')).toBe('no-store');
    const response = await app.request('/public/books/shares/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ data: { book: { key: 'safe' }, chapters: [] } });
    service.readPublicShare = async () => { throw new BookRepositoryError('not_found'); };
    expect((await app.request('/public/books/shares/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(404);
  });

  test('emits inactive immediately without leaking identity and cleans its subscription', async () => {
    let unsubscribed = 0;
    const handlers = createPublicBookShareHandlers({ service: { publicShareStatus: async () => ({ tokenHash: 'a'.repeat(64), active: false }) } as any, subscribe: () => () => { unsubscribed += 1; }, heartbeatMs: 5, revalidateMs: 5 });
    const app = new Hono(); app.get('/public/books/shares/stream', handlers.stream);
    const response = await app.request(`/public/books/shares/stream?token=${token}`);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream'); expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('event: access'); expect(text).toContain('{"status":"inactive"}'); expect(text).not.toMatch(/book|scope|reason|shareKey/); expect(unsubscribed).toBe(1);
  });

  test('reacts to a share event, revalidates canonical state, emits inactive, and closes', async () => {
    let checks = 0; let listener: (() => void) | undefined; let unsubscribed = 0;
    const handlers = createPublicBookShareHandlers({ service: { publicShareStatus: async () => ({ tokenHash: 'a'.repeat(64), active: checks++ === 0 }) } as any, subscribe: (_hash, next) => { listener = next; setTimeout(() => listener?.(), 1); return () => { unsubscribed += 1; }; }, heartbeatMs: 100, revalidateMs: 100 });
    const app = new Hono(); app.get('/public/books/shares/stream', handlers.stream);
    const response = await app.request(`/public/books/shares/stream?token=${token}`); const text = await response.text();
    expect(text.match(/event: access/g)).toHaveLength(2); expect(text).toContain('{"status":"active"}'); expect(text).toContain('{"status":"inactive"}'); expect(checks).toBeGreaterThanOrEqual(2); expect(unsubscribed).toBe(1);
  });

  test('keeps an active stream open across transient canonical read failures', async () => {
    let checks = 0;
    const handlers = createPublicBookShareHandlers({ service: { publicShareStatus: async () => { checks += 1; if (checks === 2) throw new Error('database unavailable'); return { tokenHash: 'a'.repeat(64), active: checks < 3 }; } } as any, subscribe: (_hash, next) => { setTimeout(next, 1); setTimeout(next, 5); return () => {}; }, heartbeatMs: 100, revalidateMs: 100 });
    const app = new Hono(); app.get('/public/books/shares/stream', handlers.stream);
    const text = await (await app.request(`/public/books/shares/stream?token=${token}`)).text();
    expect(text.match(/event: access/g)).toHaveLength(2); expect(text).toContain('{"status":"active"}'); expect(text).toContain('{"status":"inactive"}'); expect(checks).toBe(3);
  });
});
