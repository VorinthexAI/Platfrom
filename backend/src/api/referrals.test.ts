import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createReferralSummaryReadTool } from '@/lib/ai/tools/referral-summary-read';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import { createReferralSummaryHandler } from './referrals';
import { errorHandler } from './errors';

const summary = (userKey: string) => ({
  code: { key: 'code-key', ownerUserKey: userKey, programVersion: 'v1' as const, code: '0123456789AB', createdAt: '2026-09-05T10:00:00.000Z' },
  attributionCount: 2,
  signupRewardCount: 2,
  paidRewardCount: 1,
  earnedMicroSparks: 200_000_000,
});

describe('referral summary boundaries', () => {
  test('HTTP, unified tool, and Core call the same canonical service with trusted user identity', async () => {
    const userKey = 'user-key', teamKey = 'team-key';
    const calls: string[] = [];
    const readSummary = async (trustedUserKey: unknown) => { calls.push(String(trustedUserKey)); return summary(String(trustedUserKey)); };
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/referrals/summary', createReferralSummaryHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), readSummary }));

    const response = await app.request('/referrals/summary');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { code: { ownerUserKey: userKey }, attributionCount: 2 } });

    const context = { teamKey, runtimeScopeKey: 'scope-key', principal: { kind: 'member', user: { key: userKey }, userTeam: { key: 'membership-key', teamKey: teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(createReferralSummaryReadTool(readSummary).execute({}, { context })).resolves.toMatchObject({ code: { ownerUserKey: userKey } });
    const core = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'referral.summary.read')!;
    expect(core.executionEffect).toBe('read');
    await expect(core.execute({}, { domain: context, referrals: { readSummary } } as never)).resolves.toMatchObject({ kind: 'continue', result: { code: { ownerUserKey: userKey } } });
    expect(calls).toEqual([userKey, userKey, userKey]);
  });

  test('rejects unauthenticated, non-user, forged, and inactive contexts', async () => {
    for (const identity of [null, { key: 'member-key', identityType: 'member' as const }]) {
      const app = new Hono();
      app.get('/referrals/summary', createReferralSummaryHandler({ getIdentity: async () => identity }));
      const response = await app.request('/referrals/summary');
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    }

    const authenticated = new Hono();
    authenticated.onError(errorHandler);
    authenticated.get('/referrals/summary', createReferralSummaryHandler({ getIdentity: async () => ({ key: 'user-key', identityType: 'user' }), readSummary: async () => summary('user-key') }));
    expect((await authenticated.request('/referrals/summary?userKey=forged')).status).toBe(400);

    const context = { teamKey: 'team-key', runtimeScopeKey: 'scope-key', principal: { kind: 'member', user: { key: 'user-key' }, userTeam: { key: 'membership-key', teamKey: 'team-key', userId: 'user-key', status: 'inactive' } } } as unknown as ToolContext;
    const tool = createReferralSummaryReadTool(async () => summary('user-key'));
    await expect(tool.execute({}, { context })).rejects.toThrow('active authenticated user membership');
    await expect(tool.execute({ userKey: 'forged' }, { context })).rejects.toThrow('Unrecognized key');
    const core = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'referral.summary.read')!;
    await expect(core.execute({}, { domain: context, referrals: { readSummary: async () => summary('user-key') } } as never)).rejects.toThrow('Active matching');
    await expect(core.execute({ userKey: 'forged' }, { domain: { ...context, principal: { ...(context.principal as object), userTeam: { ...(context.principal as any).userTeam, status: 'active' } } }, referrals: { readSummary: async () => summary('user-key') } } as never)).rejects.toThrow('Unrecognized key');
  });
});
