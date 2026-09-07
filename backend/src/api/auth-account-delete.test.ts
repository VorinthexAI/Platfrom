import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createDeleteAuthAccountHandler } from './auth-account';
import { errorHandler } from './errors';
import { runTrustedTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools';

function appWith(options: { identity?: { key: string; identityType: 'user' } | null; fail?: boolean } = {}) {
  const calls: unknown[] = [];
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/auth/me/delete', createDeleteAuthAccountHandler({
    getIdentity: async () => options.identity === undefined ? { key: 'user-1', identityType: 'user' } : options.identity,
    service: { delete: async (...args: unknown[]) => { calls.push(args); if (options.fail) throw new Error('failed'); return { deleted: true as const }; } } as any,
  }));
  return { app, calls };
}

describe('POST /auth/me/delete', () => {
  test('passes only trusted identity to the canonical service and clears auth cookies', async () => {
    const context = appWith();
    const response = await context.app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'vrtx_access=old; vrtx_refresh=old' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(context.calls).toEqual([[{ confirmation: 'DELETE MY ACCOUNT' }, 'user-1']]);
    expect(response.headers.get('set-cookie')).toContain('vorinthex_access=');
    expect(response.headers.get('set-cookie')).toContain('vorinthex_refresh=');
  });

  test('rejects unknown input and forged identity', async () => {
    const context = appWith();
    const response = await context.app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT', userKey: 'forged' }) });
    expect(response.status).toBe(400);
    expect(context.calls).toEqual([]);
  });

  test('requires authentication and retains cookies when deletion fails', async () => {
    const anonymous = appWith({ identity: null });
    expect((await anonymous.app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) })).status).toBe(401);
    const failing = appWith({ fail: true });
    const response = await failing.app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) });
    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('rejects non-user identities', async () => {
    const context = appWith({ identity: { key: 'admin-1', identityType: 'superAdmin' } as never });
    expect((await context.app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) })).status).toBe(401);
    expect(context.calls).toEqual([]);
  });

  test('HTTP and trusted registry entry converge on the same canonical service', async () => {
    const calls: unknown[] = [];
    const service = { delete: async (...args: unknown[]) => { calls.push(args); return { deleted: true as const }; } } as any;
    const app = new Hono();
    app.post('/auth/me/delete', createDeleteAuthAccountHandler({ getIdentity: async () => ({ key: 'user-1', identityType: 'user' }), service }));
    await app.request('/auth/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) });
    const context = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userTeam: { key: 'membership-1', userId: 'user-1', teamKey: 'team-1', status: 'active' } } } as unknown as ToolContext;
    let observations = 0;
    await runTrustedTool('account.delete', { confirmation: 'DELETE MY ACCOUNT' }, { context, accountDeletion: service, recordEvent: async () => { observations += 1; } });
    expect(calls).toEqual([
      [{ confirmation: 'DELETE MY ACCOUNT' }, 'user-1'],
      [{ confirmation: 'DELETE MY ACCOUNT' }, 'user-1'],
    ]);
    expect(observations).toBe(0);
  });
});
