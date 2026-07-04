import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { getUserId } from './security';

describe('api security helpers', () => {
  test('uses user id set by auth middleware before reading authorization header', async () => {
    const app = new Hono<{ Variables: { userId: string } }>();
    app.use('*', async (c, next) => {
      c.set('userId', 'usr_refreshed');
      return next();
    });
    app.get('/test', async (c) => c.json({ userId: await getUserId(c) }));

    const response = await app.request('/test');

    expect(await response.json()).toEqual({ userId: 'usr_refreshed' });
  });
});
