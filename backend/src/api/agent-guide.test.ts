import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import { createAgentGreetingHandler } from './agent-guide';

describe('POST /agent/greeting', () => {
  const teamKey = 'team-1';
  const scopeKey = newId();
  const userKey = newId();
  const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId() }, scopeMember: null } } as unknown as ToolContext;

  test('requires authentication and strict transport input', async () => {
    const unauthorized = new Hono().post('/agent/greeting', createAgentGreetingHandler({ getIdentity: async () => null }));
    expect((await unauthorized.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning' }) })).status).toBe(401);

    const handler = createAgentGreetingHandler({ getIdentity: async () => ({ identityType: 'user', key: userKey }) as never, authorize: async () => ({ context }), run: async () => ({ message: 'Hello.', showReferralCodeAction: false }) });
    const app = new Hono().post('/agent/greeting', handler);
    expect((await app.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning', message: 'forged prompt' }) })).status).toBe(400);
  });

  test('dispatches the canonical agent.guide greeting without conversation persistence', async () => {
    const calls: unknown[][] = [];
    const handler = createAgentGreetingHandler({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      run: async (...args: unknown[]) => { calls.push(args); return { message: 'Welcome back. What can I help with?', showReferralCodeAction: false }; },
      recordEvent: async () => {},
      id: () => newId(),
    });
    const app = new Hono().post('/agent/greeting', handler);
    const response = await app.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { message: 'Welcome back. What can I help with?', showReferralCodeAction: false } });
    expect(calls[0]?.slice(0, 3)).toEqual(['agent.guide', '', { mode: 'greet', occasion: 'returning' }]);
    expect(JSON.stringify(calls)).not.toContain('conversation.create');
  });
});
