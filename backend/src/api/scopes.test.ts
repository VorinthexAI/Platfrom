import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createScopeHandlers } from './scopes';
import type { ToolContext } from '@/lib/ai/tools';
import { ScopeServiceError } from '@/lib/ai/scopes';
import type { ToolEventRecorder } from '@/lib/ai/events/service';

const teamKey = newId(), userKey = newId(), scopeKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey, currentScopeKey: scopeKey }, userTeam: { key: newId(), teamKey: teamKey, userId: userKey, status: 'active' }, scopeMember: null } } as unknown as ToolContext;

function appWith(service: Record<string, (...args: any[]) => Promise<unknown>>, recordEvent?: ToolEventRecorder) {
  const handlers = createScopeHandlers({ service: service as never, getIdentity: async () => ({ key: userKey, identityType: 'user' }), resolveContext: async () => context, recordEvent, appScopeKey: newId() });
  return new Hono().post('/scopes/list', handlers.list).post('/scopes', handlers.create).post('/scopes/select', handlers.select);
}

describe('scope HTTP adapters', () => {
  test('strictly validates authenticated contracts', async () => {
    const service = { list: async () => ({ scopes: [] }), create: async () => ({}), select: async () => ({}) };
    const app = appWith(service);
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await post('/scopes/list', { teamKey, userKey })).status).toBe(400);
    expect((await post('/scopes', { teamKey, name: 'Plans', scopeKey }, { 'idempotency-key': 'request-1' })).status).toBe(400);
    expect((await post('/scopes', { teamKey, name: 'Plans' })).status).toBe(400);
    expect((await post('/scopes/select', { teamKey, targetScopeKey: scopeKey, teamMembershipKey: newId() })).status).toBe(400);
    const unauthorizedHandlers = createScopeHandlers({ service: service as never, getIdentity: async () => null });
    const unauthorized = new Hono().post('/scopes/list', unauthorizedHandlers.list);
    expect((await unauthorized.request('/scopes/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey }) })).status).toBe(401);
  });

  test('calls the canonical service with authorized context and request idempotency', async () => {
    const calls: unknown[] = [];
    const events: unknown[] = [];
    const service = {
      list: async (...args: unknown[]) => { calls.push(['list', ...args]); return { scopes: [] }; },
      create: async (...args: unknown[]) => { calls.push(['create', ...args]); return { key: scopeKey }; },
      select: async (...args: unknown[]) => { calls.push(['select', ...args]); return { key: scopeKey }; },
    };
    const app = appWith(service, async (event) => { events.push(event); });
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'http-request' };
    expect((await app.request('/scopes/list', { method: 'POST', headers, body: JSON.stringify({ teamKey }) })).status).toBe(200);
    expect((await app.request('/scopes', { method: 'POST', headers, body: JSON.stringify({ teamKey, name: 'Plans', description: 'Team plans' }) })).status).toBe(201);
    expect((await app.request('/scopes/select', { method: 'POST', headers, body: JSON.stringify({ teamKey, targetScopeKey: scopeKey }) })).status).toBe(200);
    expect(calls).toEqual([
      ['list', {}, context],
      ['create', { name: 'Plans', description: 'Team plans' }, context, 'http-request'],
      ['select', { targetScopeKey: scopeKey }, context],
    ]);
    expect(events).toEqual([
      expect.objectContaining({ slug: 'scope.list', status: 'completed' }),
      expect.objectContaining({ slug: 'scope.create', status: 'completed' }),
      expect.objectContaining({ slug: 'scope.select', status: 'completed' }),
    ]);
  });

  test('maps a valid but inaccessible target scope to a controlled response', async () => {
    const service = {
      list: async () => ({ scopes: [] }),
      create: async () => ({}),
      select: async () => { throw new ScopeServiceError('FORBIDDEN', 'Active target scope membership is required.'); },
    };
    const response = await appWith(service, async () => {}).request('/scopes/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamKey, targetScopeKey: newId() }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'SCOPE_FORBIDDEN' } });
  });
});
