import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createUserInboxHandlers } from './user-inbox';

const userKey = newId(), teamKey = newId(), scopeKey = newId(), threadKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), userId: userKey, teamKey, status: 'active' } } } as unknown as ToolContext;

describe('user inbox HTTP adapters', () => {
  test('strictly adapts list, read, read-state, and follow-up to canonical tools', async () => {
    const calls: unknown[][] = [];
    const service = {
      list: async (...args: unknown[]) => { calls.push(['list', ...args]); return { items: [], unreadCount: 0, nextCursor: null }; },
      read: async (...args: unknown[]) => { calls.push(['read', ...args]); return { thread: {}, messages: [] }; },
      markRead: async (...args: unknown[]) => { calls.push(['mark', ...args]); return {}; },
      send: async (...args: unknown[]) => { calls.push(['send', ...args]); return {}; },
    } as any;
    const handlers = createUserInboxHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ context }) as never });
    const app = new Hono()
      .post('/list', handlers.list)
      .post('/:threadKey/read', handlers.read)
      .put('/:threadKey/read-state', handlers.markRead)
      .post('/:threadKey/messages', handlers.send);
    const json = (path: string, method: string, body: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify(body) });
    expect((await json('/list', 'POST', { teamKey, scopeKey, mailbox: 'sent' })).status).toBe(200);
    expect((await json(`/${threadKey}/read`, 'POST', { teamKey, scopeKey })).status).toBe(200);
    expect((await json(`/${threadKey}/read-state`, 'PUT', { teamKey, scopeKey, read: false })).status).toBe(200);
    expect((await json(`/${threadKey}/messages`, 'POST', { teamKey, scopeKey, message: 'Any update?' })).status).toBe(201);
    expect(calls).toEqual([
      ['list', { mailbox: 'sent', limit: 25 }, context],
      ['read', { threadKey }, context],
      ['mark', { threadKey, read: false }, context],
      ['send', { threadKey, message: 'Any update?' }, context, 'request-1'],
    ]);
    expect((await json('/list', 'POST', { teamKey, scopeKey, userKey })).status).toBe(400);
  });
});
