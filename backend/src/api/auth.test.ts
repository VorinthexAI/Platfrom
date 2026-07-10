import { describe, expect, test } from 'bun:test';
import { generate, generateSecret } from 'otplib';
import {
  buildMagicLink,
  buildMfaLink,
  createAccessToken,
  createChallengeTokenHash,
  verifyAccessToken,
  verifySuccessiveTotpCodes,
} from './auth';
import { decryptSecret, encryptSecret, timingSafeEqual } from '@/lib/crypto';

describe('auth helpers', () => {
  test('builds frontend magic links with token hash query param and no raw token', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    const rawToken = 'vrtx_email_test';
    const tokenHash = await createChallengeTokenHash(rawToken);
    const link = buildMagicLink(tokenHash);

    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(link).toBe(`https://app.example.com/public/auth/token?token_hash=${tokenHash}&flow=member`);
    expect(link).not.toContain(rawToken);
  });

  test('builds user-flow magic links for waitlist explorer sign-in', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    const tokenHash = await createChallengeTokenHash('vrtx_email_user');
    const link = buildMagicLink(tokenHash, 'user');

    expect(link).toBe(`https://app.example.com/public/auth/token?token_hash=${tokenHash}&flow=user`);
  });

  test('builds platform MFA links that land in the /auth/mfa biome', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    const rawToken = 'vrtx_email_member';
    const tokenHash = await createChallengeTokenHash(rawToken);
    const link = buildMfaLink(tokenHash);

    expect(link).toBe(`https://app.example.com/auth/mfa?token_hash=${tokenHash}`);
    expect(link).not.toContain(rawToken);
  });

  test('encrypts and decrypts TOTP secrets', async () => {
    process.env.TOTP_SECRET_ENCRYPTION_KEY = 'test-key';

    const encrypted = await encryptSecret('SECRET123');

    expect(encrypted).toStartWith('v1:');
    expect(encrypted).not.toContain('SECRET123');
    expect(await decryptSecret(encrypted)).toBe('SECRET123');
  });

  test('verifies access token signatures with constant-time comparison helper', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';

    const token = await createAccessToken('usr_test');

    expect(await verifyAccessToken(token)).toEqual({ key: 'usr_test', identityType: 'user' });
    expect(await verifyAccessToken(`${token}tampered`)).toBeNull();
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  test('requires two successive TOTP setup codes', async () => {
    const secret = generateSecret();
    const submittedAtEpoch = 1_800_000_030;
    const first = await generate({ secret, epoch: submittedAtEpoch - 30, period: 30 });
    const second = await generate({ secret, epoch: submittedAtEpoch, period: 30 });

    expect(await verifySuccessiveTotpCodes(secret, [first, second], submittedAtEpoch)).toBeGreaterThan(0);
    expect(await verifySuccessiveTotpCodes(secret, [first, first], submittedAtEpoch)).toBeNull();
  });
});
