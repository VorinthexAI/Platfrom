import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runTool } from '@/lib/ai/tools';
import { createReferralSummaryReadTool } from '@/lib/ai/tools/referral-summary-read';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import { ReferralRepositoryError } from '@/lib/referrals/repository';
import { createReferralRedeemHandler, createReferralSummaryHandler } from './referrals';
import { errorHandler } from './errors';
import { registerRoutes } from './routes';

const summary = (userKey: string) => ({
  code: { key: 'code-key', ownerUserKey: userKey, programVersion: 'v1' as const, code: '0123456789AB', createdAt: '2026-09-05T10:00:00.000Z' },
  attributionCount: 2,
  signupRewardCount: 2,
  paidRewardCount: 1,
  earnedMicroSparks: 200_000_000,
  invitees: [{ displayName: 'Invited Friend', signupRewardEarned: true, firstPaidRewardStatus: 'earned' as const }],
});

const redemption = {
  status: 'applied' as const,
  attributed: true as const,
  referrerName: 'Inviting Friend',
  signupRewardIssued: true as const,
  firstPaidRewardStatus: 'pending' as const,
};

describe('referral summary boundaries', () => {
  test('HTTP, unified tool, and Core call the same canonical service with trusted user identity', async () => {
    const userKey = 'user-key', teamKey = 'team-key';
    const calls: string[] = [];
    const readSummary = async (trustedUserKey: unknown) => { calls.push(String(trustedUserKey)); return summary(String(trustedUserKey)); };
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/referrals/summary', createReferralSummaryHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), readSummary }));

    const legacyResponse = await app.request('/referrals/summary');
    expect(legacyResponse.status).toBe(200);
    expect(await legacyResponse.json()).toEqual({ success: true, data: {
      code: summary(userKey).code,
      attributionCount: 2,
      signupRewardCount: 2,
      paidRewardCount: 1,
      earnedMicroSparks: 200_000_000,
    } });

    const response = await app.request('/referrals/summary?includeInvitees=true');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { code: { ownerUserKey: userKey }, attributionCount: 2, invitees: [{ displayName: 'Invited Friend', firstPaidRewardStatus: 'earned' }] } });

    const context = { teamKey, runtimeScopeKey: 'scope-key', principal: { kind: 'member', user: { key: userKey }, userTeam: { key: 'membership-key', teamKey: teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(createReferralSummaryReadTool(readSummary).execute({}, { context })).resolves.toMatchObject({ code: { ownerUserKey: userKey } });
    const core = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'referral.summary.read')!;
    expect(core.executionEffect).toBe('read');
    await expect(core.execute({}, { domain: context, referrals: { readSummary } } as never)).resolves.toMatchObject({ kind: 'continue', result: { code: { ownerUserKey: userKey } } });
    expect(calls).toEqual([userKey, userKey, userKey, userKey]);
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
    expect((await authenticated.request('/referrals/summary?includeInvitees=false')).status).toBe(400);

    const context = { teamKey: 'team-key', runtimeScopeKey: 'scope-key', principal: { kind: 'member', user: { key: 'user-key' }, userTeam: { key: 'membership-key', teamKey: 'team-key', userId: 'user-key', status: 'inactive' } } } as unknown as ToolContext;
    const tool = createReferralSummaryReadTool(async () => summary('user-key'));
    await expect(tool.execute({}, { context })).rejects.toThrow('active authenticated user membership');
    await expect(tool.execute({ userKey: 'forged' }, { context })).rejects.toThrow('Unrecognized key');
    const core = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'referral.summary.read')!;
    await expect(core.execute({}, { domain: context, referrals: { readSummary: async () => summary('user-key') } } as never)).rejects.toThrow('Active matching');
    await expect(core.execute({ userKey: 'forged' }, { domain: { ...context, principal: { ...(context.principal as object), userTeam: { ...(context.principal as any).userTeam, status: 'active' } } }, referrals: { readSummary: async () => summary('user-key') } } as never)).rejects.toThrow('Unrecognized key');
  });
});

describe('referral redemption boundaries', () => {
  test('HTTP, unified tool, and Core invoke the same canonical redeem method with trusted identity', async () => {
    const userKey = 'trusted-user-key';
    const calls: unknown[][] = [];
    const redeem = async (...args: unknown[]) => { calls.push(args); return redemption; };
    const context = { teamKey: 'team-key', runtimeScopeKey: 'scope-key', principal: { kind: 'member', user: { key: userKey }, userTeam: { key: 'membership-key', teamKey: 'team-key', userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const app = new Hono();
    app.onError(errorHandler);
    app.post('/referrals/redeem', createReferralRedeemHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), redeem }));

    const response = await app.request('/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ' 0123456789AB ' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: redemption });
    await expect(runTool('referral.redeem', '', { code: '0123456789AB' }, { contentContext: context, referralService: { redeem, readSummary: async () => summary(userKey) } })).resolves.toEqual(redemption);
    const core = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'referral.redeem')!;
    await expect(core.execute({ code: '0123456789AB' }, { domain: context, referrals: { redeem } } as never)).resolves.toMatchObject({ kind: 'continue', result: redemption });
    expect(calls).toEqual(Array.from({ length: 3 }, () => [userKey, '0123456789AB']));
  });

  test('rejects unknown fields and never accepts a caller-supplied identity', async () => {
    const calls: unknown[][] = [];
    const app = new Hono();
    app.onError(errorHandler);
    app.post('/referrals/redeem', createReferralRedeemHandler({
      getIdentity: async () => ({ key: 'trusted-user-key', identityType: 'user' }),
      redeem: async (...args: unknown[]) => { calls.push(args); return redemption; },
    }));
    const response = await app.request('/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '0123456789AB', userKey: 'forged-user-key' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(calls).toEqual([]);
  });

  test('requires an authenticated user identity', async () => {
    for (const identity of [null, { key: 'member-key', identityType: 'member' as const }]) {
      let calls = 0;
      const app = new Hono().post('/referrals/redeem', createReferralRedeemHandler({ getIdentity: async () => identity, redeem: async () => { calls += 1; return redemption; } }));
      const response = await app.request('/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '0123456789AB' }) });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(calls).toBe(0);
    }
  });

  test.each([
    ['INVALID_CODE', 404, 'REFERRAL_INVALID_CODE'],
    ['SELF_REFERRAL', 422, 'REFERRAL_SELF_REFERRAL'],
    ['ALREADY_ATTRIBUTED', 409, 'REFERRAL_ALREADY_ATTRIBUTED'],
  ] as const)('maps %s repository errors safely', async (repositoryCode, status, responseCode) => {
    const app = new Hono().post('/referrals/redeem', createReferralRedeemHandler({
      getIdentity: async () => ({ key: 'trusted-user-key', identityType: 'user' }),
      redeem: async () => { throw new ReferralRepositoryError(repositoryCode, 'private repository detail'); },
    }));
    const response = await app.request('/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '0123456789AB' }) });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, error: { code: responseCode } });
    expect(JSON.stringify(body)).not.toContain('private repository detail');
  });

  test('registers POST /api/v1/referrals/redeem', async () => {
    const app = new Hono();
    registerRoutes(app.basePath('/api/v1'));
    const response = await app.request('/api/v1/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '0123456789AB' }) });
    expect(response.status).toBe(401);
  });
});
