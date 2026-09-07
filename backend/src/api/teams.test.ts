import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createTeamHandlers, teamHttpSelectInputSchema } from './teams';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

const context = { teamKey: 'team-1', runtimeScopeKey: 'cm1234567890123456789012345', principal: { kind: 'member', user: { key: 'user-1' }, userTeam: { key: 'membership-1', userId: 'user-1', teamKey: 'team-1', status: 'active' }, scopeMember: null } } as ToolContext;

describe('team HTTP parity', () => {
  test('uses strict transport input and the same canonical service as the unified tool', async () => {
    const calls: unknown[] = [];
    const service = {
      list: async (input: unknown, selected: ToolContext) => { calls.push(['list', input, selected]); return { teams: [] }; },
      select: async (input: unknown, selected: ToolContext) => { calls.push(['select', input, selected]); return { status: 'selected' }; },
    } as never;
    const handlers = createTeamHandlers({ service, getIdentity: async () => ({ key: 'user-1', identityType: 'user' }), resolveContext: async () => context });
    const app = new Hono(); app.post('/teams/list', handlers.list); app.post('/teams/select', handlers.select);
    expect((await app.request('/teams/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect((await app.request('/teams/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetTeamKey: 'team-1' }) })).status).toBe(200);
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(['list', 'select']);
    expect((await app.request('/teams/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetTeamKey: 'team-1', userKey: 'forged' }) })).status).toBe(400);
  });

  test('rejects unauthenticated requests', async () => {
    const handlers = createTeamHandlers({ getIdentity: async () => null });
    const app = new Hono(); app.post('/teams/list', handlers.list);
    expect((await app.request('/teams/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  test('does not accept identity, membership, or provenance selectors', () => {
    for (const field of ['userKey', 'teamMembershipKey', 'environmentSeeded']) {
      expect(() => teamHttpSelectInputSchema.parse({ targetTeamKey: 'team-1', [field]: 'forged' })).toThrow('Unrecognized key');
    }
  });
});
