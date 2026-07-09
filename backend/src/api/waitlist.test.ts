import { describe, expect, mock, test } from 'bun:test';
import {
  buildWaitlistVerifyLink,
  normalizeWaitlistEmail,
  requestWaitlistVerification,
  type WaitlistVerificationDeps,
} from './waitlist';
import type { User } from '@/lib/db/users.node';

describe('waitlist helpers', () => {
  test('normalizes waitlist emails', () => {
    expect(normalizeWaitlistEmail('  PERSON@Example.COM ')).toBe('person@example.com');
  });

  test('builds frontend verification links with token hash query param', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    expect(buildWaitlistVerifyLink('abc123')).toBe('https://app.example.com/public/waitlist/verify?token_hash=abc123&flow=waitlist');
  });
});

function makeUser(overrides: Partial<User>): User {
  return {
    key: 'usr_test',
    email: 'person@example.com',
    emailHash: 'hash',
    name: 'Person',
    alias: 'Silent Scout',
    alias_slug: 'silent-scout',
    isVerified: false,
    waitlistNumber: 42,
    ...overrides,
  } as User;
}

function makeDeps(user: User, overrides: Partial<WaitlistVerificationDeps> = {}): WaitlistVerificationDeps {
  return {
    upsertUserByEmail: mock(async () => user),
    adoptExplorerFragments: mock(async () => 0),
    trackPlatformEvent: mock(() => {}),
    notifyCountersDirty: mock(() => {}),
    requestSignInEmail: mock(async () => ({ allowed: false as const })),
    sendWaitlistVerificationEmailForUser: mock(async () => ({
      verifyLink: 'https://app.example.com/verify',
      expiresAt: new Date(Date.now() + 1000),
      handoffTokenHash: 'handoff-hash',
      handoffExpiresAt: new Date(Date.now() + 2000),
    })),
    ...overrides,
  };
}

describe('requestWaitlistVerification', () => {
  test('sends the verification email for unverified users', async () => {
    const user = makeUser({ isVerified: false });
    const deps = makeDeps(user);

    const result = await requestWaitlistVerification('person@example.com', undefined, undefined, undefined, deps);

    expect(result.isVerified).toBe(false);
    expect(deps.sendWaitlistVerificationEmailForUser).toHaveBeenCalledTimes(1);
    expect(deps.requestSignInEmail).not.toHaveBeenCalled();
  });

  test('sends a sign-in email instead when the user is already verified', async () => {
    const user = makeUser({ isVerified: true });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const handoffExpiresAt = new Date(expiresAt.getTime() + 60 * 1000);
    const deps = makeDeps(user, {
      requestSignInEmail: mock(async () => ({
        allowed: true as const,
        expiresAt,
        handoffTokenHash: 'signin-handoff',
        handoffExpiresAt,
      })),
    });

    const result = await requestWaitlistVerification('person@example.com', undefined, undefined, undefined, deps);

    expect(result.isVerified).toBe(true);
    expect(deps.requestSignInEmail).toHaveBeenCalledWith('person@example.com');
    expect(deps.sendWaitlistVerificationEmailForUser).not.toHaveBeenCalled();
    if (result.isVerified) {
      expect(result.signInEmailSent).toBe(true);
      expect(result.handoffTokenHash).toBe('signin-handoff');
    }
  });

  test('reports signInEmailSent=false when the verified user cannot sign in', async () => {
    const user = makeUser({ isVerified: true });
    const deps = makeDeps(user);

    const result = await requestWaitlistVerification('person@example.com', undefined, undefined, undefined, deps);

    expect(result.isVerified).toBe(true);
    if (result.isVerified) {
      expect(result.signInEmailSent).toBe(false);
      expect('handoffTokenHash' in result && result.handoffTokenHash).toBeFalsy();
    }
  });
});
