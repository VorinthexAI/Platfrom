import { describe, expect, test } from 'bun:test';
import { generate, generateSecret } from 'otplib';
import { acceptVerifiedChallenge, createAccessToken, getAuthSessionPolicy, isChallengeUsableForPurpose, verifyAccessToken, verifySuccessiveTotpCodes } from './auth';
import { hasFounderAssurance } from './founders';
import { ensureSeededActiveRootMembersVerified, type SeedVerificationDataSource } from '../../scripts/seed-verification';
import { teamSchema } from '@/lib/db/teams.node';
import { userTeamSchema } from '@/lib/db/user-team.node';
import { userSchema } from '@/lib/db/users.node';
import { requireFoundersGateAccess, type FoundersAccessDataSource } from '@/lib/founders/access';

describe('seeded founder authentication state machine', () => {
  test('requires first-use setup, rejects replay, and preserves assurance only while root membership and MFA version remain current', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'founder-state-machine-secret';
    const now = '2026-09-06T00:00:00.000Z';
    const root = teamSchema.parse({ key: 'root-team', name: 'Vorinthex AI', is_root: true, mfa_enabled: true, createdAt: now, updatedAt: now });
    const user = userSchema.parse({ key: 'seeded-founder', teamKey: root.key, currentScopeKey: 'cm1234567890123456789012345', email: 'founder@example.com', emailHash: 'founder-hash', isVerified: false, createdAt: now, updatedAt: now });
    let membership = userTeamSchema.parse({ key: 'root-membership', teamKey: root.key, userId: user.key, teamRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    const challenges = new Map<string, { kind: 'founder_email' | 'founder_setup' | 'founder_totp'; consumedAt: string | null; expiresAt: string }>();

    const seedSource: SeedVerificationDataSource = {
      async listActiveRootMemberUserKeys(keys) {
        return keys.includes(user.key) && membership.status === 'active' ? [user.key] : [];
      },
      async markUsersVerified(keys) {
        if (keys.includes(user.key)) user.isVerified = true;
      },
    };
    await ensureSeededActiveRootMembersVerified([user.key], now, seedSource);
    expect(user.isVerified).toBe(true);

    const accessSource: FoundersAccessDataSource = {
      async getUser(key) { return key === user.key ? user : null; },
      async getRootTeam() { return root; },
      async getTeam(key) { return key === root.key ? root : null; },
      async getMembership(teamKey, userId) {
        return teamKey === root.key && userId === user.key ? membership : null;
      },
      async listActiveMemberships() { return membership.status === 'active' ? [membership] : []; },
      async listScopes() { return []; },
      async listChildRelations() { return []; },
      async getScope() { return null; },
      async listScopeMembers() { return []; },
    };

    // The public login identifies a DB-backed root member and routes to the founders gate.
    expect((await requireFoundersGateAccess(user.key, accessSource)).rootMembership.key).toBe(membership.key);
    expect(root.mfa_enabled).toBe(true);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    challenges.set('email-proof', { kind: 'founder_email', consumedAt: null, expiresAt });
    const emailChallenge = challenges.get('email-proof')!;
    expect(isChallengeUsableForPurpose(emailChallenge, ['founder_email'])).toBe(true);
    expect(await acceptVerifiedChallenge(
      async () => isChallengeUsableForPurpose(emailChallenge, ['founder_email']) ? membership : null,
      async () => {
        if (emailChallenge.consumedAt) return false;
        emailChallenge.consumedAt = new Date().toISOString();
        return true;
      },
    )).toBe(membership);
    expect(isChallengeUsableForPurpose(emailChallenge, ['founder_email'])).toBe(false);

    // First use has no TOTP enrollment and requires two successive time-step codes.
    expect(membership.isMfaEnabled).toBe(false);
    const secret = generateSecret();
    const setupEpoch = 1_800_000_030;
    const setupCodes: [string, string] = [
      await generate({ secret, epoch: setupEpoch - 30, period: 30 }),
      await generate({ secret, epoch: setupEpoch, period: 30 }),
    ];
    const setupTimeStep = await verifySuccessiveTotpCodes(secret, setupCodes, setupEpoch);
    expect(setupTimeStep).not.toBeNull();
    membership = { ...membership, isMfaEnabled: true, totpSecret: 'encrypted-secret', lastTotpTimeStep: setupTimeStep };

    const assuredIdentity = { key: user.key, identityType: 'superAdmin' as const, founderAssured: true, teamMembershipKey: membership.key, teamMfaVersion: membership.teamMfaVersion };
    const accessToken = await createAccessToken(assuredIdentity);
    const verifiedIdentity = await verifyAccessToken(accessToken);
    expect(hasFounderAssurance(verifiedIdentity, membership)).toBe(true);
    expect((await requireFoundersGateAccess(verifiedIdentity!.key, accessSource)).user.key).toBe(user.key);
    expect(getAuthSessionPolicy('superAdmin', true)).toEqual({ accessMaxAgeSeconds: 900, refreshMaxAgeSeconds: 86_400 });

    // Every fresh sign-in returns to TOTP, and one time step cannot be replayed.
    expect(membership.isMfaEnabled ? 'totp_required' : 'totp_setup_required').toBe('totp_required');
    const signInEpoch = setupEpoch + 30;
    const signInCode = await generate({ secret, epoch: signInEpoch, period: 30 });
    let acceptedTimeStep = membership.lastTotpTimeStep;
    const verifyFreshCode = async () => {
      const candidate = await verifySuccessiveTotpCodes(secret, [setupCodes[1], signInCode], signInEpoch);
      if (candidate === null || (acceptedTimeStep !== null && candidate <= acceptedTimeStep)) return null;
      return candidate;
    };
    const totpChallenge = { kind: 'founder_totp' as const, consumedAt: null as string | null, expiresAt };
    expect(await acceptVerifiedChallenge(verifyFreshCode, async () => {
      if (totpChallenge.consumedAt) return false;
      totpChallenge.consumedAt = new Date().toISOString();
      acceptedTimeStep = (await verifyFreshCode())!;
      return true;
    })).not.toBeNull();
    expect(await acceptVerifiedChallenge(verifyFreshCode, async () => false)).toBeNull();

    // Refresh keeps founder assurance only against the current active root membership and MFA version.
    expect(hasFounderAssurance(verifiedIdentity, membership)).toBe(true);
    membership = { ...membership, teamMfaVersion: membership.teamMfaVersion + 1 };
    expect(hasFounderAssurance(verifiedIdentity, membership)).toBe(false);
    membership = { ...membership, teamMfaVersion: assuredIdentity.teamMfaVersion, status: 'suspended' };
    await expect(requireFoundersGateAccess(user.key, accessSource)).rejects.toThrow('no active root team membership');
  });
});
