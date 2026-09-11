import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createAppNotificationHandlers } from './app-notifications';

describe('notification history HTTP transport', () => {
  test('uses the canonical app.history service with trusted identity and strict selectors', async () => {
    const userKey = newId();
    const teamKey = newId();
    const scopeKey = newId();
    const calls: unknown[][] = [];
    const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey: teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const handlers = createAppNotificationHandlers({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => ({ context }) as never,
      service: { list: async (...args: unknown[]) => { calls.push(args); return { items: [], unreadCount: 0, nextCursor: null }; } } as never,
    });
    const app = new Hono();
    app.post('/notifications', handlers.list);
    const request = (body: unknown) => app.request('/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await request({ teamKey, scopeKey, mailbox: 'sent', limit: 25 })).status).toBe(200);
    expect(calls).toEqual([[{ mailbox: 'sent', limit: 25 }, context]]);
    expect((await request({ teamKey, scopeKey, userKey })).status).toBe(400);
  });

  test('enforces authentication and trusted installation context for registration', async () => {
    const body = { token: 'ExpoPushToken[token]', projectId: crypto.randomUUID(), platform: 'ios' };
    const request = async (getIdentity: () => Promise<unknown>, installationKey?: string, payload: unknown = body) => {
      const calls: unknown[][] = [];
      const handlers = createAppNotificationHandlers({
        getIdentity: getIdentity as never,
        getInstallationIdentifier: () => installationKey ?? null,
        service: { register: async (...args: unknown[]) => { calls.push(args); return { key: newId() }; } } as never,
      });
      const app = new Hono(); app.put('/subscription', handlers.register);
      const response = await app.request('/subscription', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { calls, response };
    };
    expect((await request(async () => null, 'installation-1')).response.status).toBe(401);
    expect((await request(async () => ({ key: newId(), identityType: 'member' }), 'installation-1')).response.status).toBe(403);
    expect((await request(async () => ({ key: newId(), identityType: 'user' }))).response.status).toBe(400);
    const userKey = newId();
    const success = await request(async () => ({ key: userKey, identityType: 'user' }), 'installation-1');
    expect(success.response.status).toBe(200);
    expect(success.calls).toEqual([[userKey, 'installation-1', body]]);
    expect((await request(async () => ({ key: userKey, identityType: 'user' }), 'installation-1', { ...body, userKey })).response.status).toBe(400);
  });

  test('rejects malformed or non-empty unregister bodies and unregisters only the trusted installation', async () => {
    const userKey = newId();
    const calls: unknown[][] = [];
    const handlers = createAppNotificationHandlers({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      getInstallationIdentifier: () => 'installation-1',
      service: { unregister: async (...args: unknown[]) => { calls.push(args); return { removed: true }; } } as never,
    });
    const app = new Hono(); app.delete('/subscription', handlers.unregister);
    const request = (body: string) => app.request('/subscription', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body });
    expect((await request('{')).status).toBe(400);
    expect((await request('{"installationKey":"forged"}')).status).toBe(400);
    expect((await request('{}')).status).toBe(200);
    expect(calls).toEqual([[userKey, 'installation-1']]);
  });

});
