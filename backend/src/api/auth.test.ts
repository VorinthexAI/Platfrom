import { describe, expect, test } from 'bun:test';
import { generate, generateSecret } from 'otplib';
import {
  acceptVerifiedChallenge,
  buildMagicLink,
  buildMfaLink,
  buildMobileOAuthAuthorizationUrl,
  buildOAuthAuthorizationUrl,
  FOUNDER_ACCESS_MAX_AGE_SECONDS,
  FOUNDER_REFRESH_MAX_AGE_SECONDS,
  STANDARD_ACCESS_MAX_AGE_SECONDS,
  STANDARD_REFRESH_MAX_AGE_SECONDS,
  createAccessToken,
  createChallengeTokenHash,
  getAuthSessionPolicy,
  isChallengeUsableForPurpose,
  isRefreshTokenActive,
  loginIdentityTypeForMembership,
  resolveRefreshedIdentityType,
  verifyAccessToken,
  verifyAppleIdentityToken,
  verifyGoogleIdentityToken,
  verifySuccessiveTotpCodes,
} from './auth';
import { decryptSecret, encryptSecret, sha256, timingSafeEqual } from '@/lib/crypto';

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

  test('builds user-flow magic links for account sign-in', async () => {
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

  test('builds Google OAuth authorization URLs with a signed state', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';

    const url = new URL(await buildOAuthAuthorizationUrl('google', 'https://app.example.com/api/auth/oauth/google/callback'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/oauth/google/callback');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  });

  test('builds Apple OAuth authorization URLs with the callback URI', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    process.env.APPLE_OAUTH_CLIENT_ID = 'com.example.service';

    const url = new URL(await buildOAuthAuthorizationUrl('apple', 'https://app.example.com/api/auth/oauth/apple/callback'));

    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(url.searchParams.get('client_id')).toBe('com.example.service');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/oauth/apple/callback');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  });

  test('allows only the mobile application OAuth callback by default', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    delete process.env.MOBILE_OAUTH_REDIRECT_URIS;

    const url = new URL(await buildMobileOAuthAuthorizationUrl('google', 'vorinthexcore://auth/oauth-complete'));
    expect(url.searchParams.get('redirect_uri')).toContain('/api/v1/auth/mobile/oauth/google/callback');
    await expect(buildMobileOAuthAuthorizationUrl('google', 'https://attacker.example/callback')).rejects.toThrow('not allowed');
  });

  test('accepts only cryptographically verified Apple identity tokens', async () => {
    process.env.APPLE_OAUTH_CLIENT_ID = 'com.example.service';
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', kid: 'apple-test' });
    const tokenFor = async (claims: Record<string, unknown>) => {
      const payload = encode({
        iss: 'https://appleid.apple.com',
        sub: 'apple-user-123',
        aud: 'com.example.service',
        exp: Math.floor(Date.now() / 1000) + 300,
        email: 'verified@example.com',
        ...claims,
      });
      const signingInput = `${header}.${payload}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signingInput));
      return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
    };
    const token = await tokenFor({ email_verified: true });
    const loadKeys = async () => [{ ...publicJwk, kid: 'apple-test', alg: 'RS256' }];

    expect(await verifyAppleIdentityToken(token, loadKeys)).toEqual({ email: 'verified@example.com', name: null, profileUrl: null });
    expect(await verifyAppleIdentityToken(await tokenFor({}), loadKeys)).toBeNull();
    expect(await verifyAppleIdentityToken(`${token.slice(0, token.lastIndexOf('.'))}.invalid`, loadKeys)).toBeNull();
    process.env.APPLE_OAUTH_CLIENT_ID = 'another-client';
    expect(await verifyAppleIdentityToken(token, loadKeys)).toBeNull();

    const nonce = '8e3ca6b9-2ec0-4e42-9af1-661655432427';
    const nativeToken = await tokenFor({ aud: 'app.vorinthex.com', nonce: await sha256(nonce), email_verified: true });
    expect(await verifyAppleIdentityToken(nativeToken, loadKeys, { clientId: 'app.vorinthex.com', nonce })).toEqual({
      email: 'verified@example.com',
      name: null,
      profileUrl: null,
    });
    expect(await verifyAppleIdentityToken(nativeToken, loadKeys, { clientId: 'app.vorinthex.com', nonce: crypto.randomUUID() })).toBeNull();
  });

  test('accepts only cryptographically verified Google identity tokens', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-web-client';
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', kid: 'google-test' });
    const tokenFor = async (claims: Record<string, unknown>) => {
      const payload = encode({
        iss: 'https://accounts.google.com',
        aud: 'google-web-client',
        sub: 'google-user-123',
        exp: Math.floor(Date.now() / 1000) + 300,
        email: 'verified@example.com',
        email_verified: true,
        name: 'Verified User',
        picture: 'https://example.com/avatar.png',
        ...claims,
      });
      const signingInput = `${header}.${payload}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signingInput));
      return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
    };
    const loadKeys = async () => [{ ...publicJwk, kid: 'google-test', alg: 'RS256', use: 'sig' }];

    expect(await verifyGoogleIdentityToken(await tokenFor({}), loadKeys)).toEqual({
      email: 'verified@example.com',
      name: 'Verified User',
      profileUrl: 'https://example.com/avatar.png',
    });
    expect(await verifyGoogleIdentityToken(await tokenFor({ aud: 'another-client' }), loadKeys)).toBeNull();
    expect(await verifyGoogleIdentityToken(await tokenFor({ email_verified: false }), loadKeys)).toBeNull();
    expect(await verifyGoogleIdentityToken(await tokenFor({ exp: Math.floor(Date.now() / 1000) - 1 }), loadKeys)).toBeNull();
    expect(await verifyGoogleIdentityToken(await tokenFor({ sub: null }), loadKeys)).toBeNull();
    expect(await verifyGoogleIdentityToken(await tokenFor({}), async () => { throw new Error('offline'); })).toBeNull();
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

    expect(await verifyAccessToken(token)).toEqual({ key: 'usr_test', identityType: 'user', founderAssured: false });
    expect(await verifyAccessToken(`${token}tampered`)).toBeNull();
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  test('binds issued access claims to a durable session id', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    const token = await createAccessToken({ key: 'usr_test', identityType: 'user', sessionId: 'session-test' });
    const payload = JSON.parse(Buffer.from(token.slice('vrtx_access_'.length).split('.')[0]!, 'base64url').toString('utf8')) as { sid?: string };
    expect(payload.sid).toBe('session-test');
  });

  test('uses 15-minute access and one-day absolute refresh for founders', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    const sessionExpiresAt = new Date(Date.now() + FOUNDER_REFRESH_MAX_AGE_SECONDS * 1000);
    const token = await createAccessToken({ key: 'founder_test', identityType: 'superAdmin' }, sessionExpiresAt);
    const payload = JSON.parse(Buffer.from(token.slice('vrtx_access_'.length).split('.')[0]!, 'base64url').toString('utf8')) as { iat: number; exp: number };

    expect(payload.exp - payload.iat).toBe(FOUNDER_ACCESS_MAX_AGE_SECONDS);
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(sessionExpiresAt.getTime() / 1000));
    expect(isRefreshTokenActive(sessionExpiresAt.toISOString(), sessionExpiresAt.getTime() - 1)).toBe(true);
    expect(isRefreshTokenActive(sessionExpiresAt.toISOString(), sessionExpiresAt.getTime())).toBe(false);
    expect(isRefreshTokenActive(null)).toBe(false);
    expect(loginIdentityTypeForMembership('owner', true)).toBe('superAdmin');
    expect(loginIdentityTypeForMembership('owner', false)).toBe('member');
  });

  test('carries founder MFA assurance for non-owner root members', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    const token = await createAccessToken({ key: 'root_member', identityType: 'member', founderAssured: true });
    const payload = JSON.parse(Buffer.from(token.slice('vrtx_access_'.length).split('.')[0]!, 'base64url').toString('utf8')) as { founder: boolean; iat: number; exp: number };

    expect(payload.founder).toBe(true);
    expect(payload.exp - payload.iat).toBe(FOUNDER_ACCESS_MAX_AGE_SECONDS);
    expect(await verifyAccessToken(token)).toEqual({ key: 'root_member', identityType: 'member', founderAssured: true });
  });

  test('uses 15-minute access and one-year refresh for ordinary sessions', async () => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
    const sessionExpiresAt = new Date(Date.now() + STANDARD_REFRESH_MAX_AGE_SECONDS * 1000);
    const token = await createAccessToken({ key: 'user_test', identityType: 'user' }, sessionExpiresAt);
    const payload = JSON.parse(Buffer.from(token.slice('vrtx_access_'.length).split('.')[0]!, 'base64url').toString('utf8')) as { iat: number; exp: number };

    expect(payload.exp - payload.iat).toBe(STANDARD_ACCESS_MAX_AGE_SECONDS);
    expect(isRefreshTokenActive(sessionExpiresAt.toISOString())).toBe(true);
    expect(getAuthSessionPolicy('user')).toEqual({ accessMaxAgeSeconds: STANDARD_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: STANDARD_REFRESH_MAX_AGE_SECONDS });
    expect(getAuthSessionPolicy('member')).toEqual({ accessMaxAgeSeconds: STANDARD_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: STANDARD_REFRESH_MAX_AGE_SECONDS });
    expect(getAuthSessionPolicy('member', true)).toEqual({ accessMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS });
    expect(getAuthSessionPolicy('superAdmin')).toEqual({ accessMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS });
  });

  test('preserves a durable user identity when refreshing after organization membership is created', () => {
    expect(resolveRefreshedIdentityType('user', 'member', true, false)).toBe('user');
    expect(resolveRefreshedIdentityType(undefined, 'member', true, false)).toBe('user');
    expect(resolveRefreshedIdentityType('member', 'superAdmin', true, false)).toBe('member');
    expect(resolveRefreshedIdentityType(undefined, 'superAdmin', true, true)).toBe('superAdmin');
  });

  test('requires two successive TOTP setup codes', async () => {
    const secret = generateSecret();
    const submittedAtEpoch = 1_800_000_030;
    const first = await generate({ secret, epoch: submittedAtEpoch - 30, period: 30 });
    const second = await generate({ secret, epoch: submittedAtEpoch, period: 30 });

    expect(await verifySuccessiveTotpCodes(secret, [first, second], submittedAtEpoch)).toBeGreaterThan(0);
    expect(await verifySuccessiveTotpCodes(secret, [first, first], submittedAtEpoch)).toBeNull();
  });

  test('keeps a challenge available when its proof fails', async () => {
    let consumeCalls = 0;

    const result = await acceptVerifiedChallenge(
      async () => null,
      async () => {
        consumeCalls += 1;
        return true;
      },
    );

    expect(result).toBeNull();
    expect(consumeCalls).toBe(0);
  });

  test('returns a verified result only when the challenge is claimed', async () => {
    let available = true;
    const consume = async () => {
      if (!available) return false;
      available = false;
      return true;
    };

    expect(await acceptVerifiedChallenge(async () => 42, consume)).toBe(42);
    expect(await acceptVerifiedChallenge(async () => 42, consume)).toBeNull();
  });

  test('purpose-binds founder login, setup, and recovery challenges', () => {
    const founderLogin = {
      kind: 'founder_totp' as const,
      consumedAt: null,
      expiresAt: '2026-08-06T12:05:00.000Z',
    };
    const now = Date.parse('2026-08-06T12:00:00.000Z');

    expect(isChallengeUsableForPurpose(founderLogin, ['founder_totp'], now)).toBe(true);
    expect(isChallengeUsableForPurpose(founderLogin, ['founder_recovery'], now)).toBe(false);
    expect(isChallengeUsableForPurpose(founderLogin, ['founder_setup'], now)).toBe(false);
    expect(isChallengeUsableForPurpose({ ...founderLogin, consumedAt: '2026-08-06T12:01:00.000Z' }, ['founder_totp'], now)).toBe(false);
    expect(isChallengeUsableForPurpose(founderLogin, ['founder_totp'], Date.parse(founderLogin.expiresAt))).toBe(false);
  });
});
