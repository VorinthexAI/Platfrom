import { getAuthChallengeByTokenHash, insertAuthChallenge, updateAuthChallenge, type authIdentityTypeSchema } from '@/lib/db/auth-challenges.node';
import { decryptSecret, encryptSecret, randomToken, sha256, timingSafeEqual } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { adoptExplorerFragments } from '@/lib/db/intelligence-fragments.node';
import { verify as verifyTotpToken } from '@otplib/totp';
import { base32 } from '@otplib/plugin-base32-scure';
import { crypto as otpCrypto } from '@otplib/plugin-crypto-noble';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { sendBrandedEmail } from './email';
import { defaultNameFromEmail, hashUserEmail, normalizeEmail, upsertUserByEmail } from './users';
import { getUserByEmailHash, getUserById, getUserByRefreshTokenHash, updateUser, type User } from '@/lib/db/users.node';
import { generateAlias, pickWelcomeLine } from '@/lib/alias';
import { trackPlatformEvent } from '@/platform/events';
import { approveHandoff, createHandoffSecret, HANDOFF_CLAIM_WINDOW_MS } from './auth-handoff';
import { notifyCountersDirty } from './live-bus';

const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;
/** Platform-role links (MFA sign-in, setup, recovery) burn out in 5 minutes. */
const MEMBER_LINK_TTL_MS = 5 * 60 * 1000;
const TOTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MFA_RESET_LINK_TTL_MS = MEMBER_LINK_TTL_MS;
const TOTP_PERIOD_SECONDS = 30;
const ISSUER = 'Vorinthex';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export type AuthIdentityType = 'user' | 'member' | 'superAdmin';
export type LoginIdentityType = Exclude<AuthIdentityType, 'user'>;

export interface AuthIdentity {
  key: string;
  identityType: AuthIdentityType;
}

interface LoginIdentity {
  type: LoginIdentityType;
  key: string;
  email: string;
  emailHash: string;
  name: string | null;
  isMfaEnabled: boolean;
  has_request_mfa_reset_link: boolean;
  requested_mfa_reset_link_at: string | null;
  totpSecret: string | null;
  lastTotpTimeStep: number | null;
}

type ChallengeIdentityType = typeof authIdentityTypeSchema._type;

export type MagicLinkValidationResult =
  | { status: 'totp_setup_required'; totpChallengeToken: string; expiresAt: Date }
  | { status: 'totp_required'; totpChallengeToken: string; expiresAt: Date }
  | {
    status: 'authenticated';
    identity: AuthIdentity;
    accessToken: string;
    refreshToken: string;
    alias: string;
    aliasSlug: string | null;
    waitlistNumber: number | null;
    welcomeLine: string;
  };

export function hasUsableMfaResetRequest(input: {
  has_request_mfa_reset_link: boolean;
  requested_mfa_reset_link_at: string | null;
}, nowMs = Date.now()) {
  if (!input.has_request_mfa_reset_link || !input.requested_mfa_reset_link_at) return false;
  const requestedAt = new Date(input.requested_mfa_reset_link_at).getTime();
  return Number.isFinite(requestedAt) && requestedAt + MFA_RESET_LINK_TTL_MS > nowMs;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

async function signAccessTokenPayload(payload: string) {
  return sha256(`${payload}.${process.env.ACCESS_TOKEN_SECRET || 'dev-access-token-secret'}`);
}

function platformIdentity(user: User): LoginIdentity | null {
  if (user.platform_role === 'owner') {
    return {
      type: 'superAdmin',
      key: user.key,
      email: user.email,
      emailHash: user.emailHash,
      name: user.name,
      isMfaEnabled: user.isMfaEnabled,
      has_request_mfa_reset_link: user.has_request_mfa_reset_link,
      requested_mfa_reset_link_at: user.requested_mfa_reset_link_at,
      totpSecret: user.totpSecret,
      lastTotpTimeStep: user.lastTotpTimeStep,
    };
  }
  if (user.platform_role === 'admin' || user.platform_role === 'viewer') {
    return {
      type: 'member',
      key: user.key,
      email: user.email,
      emailHash: user.emailHash,
      name: user.name,
      isMfaEnabled: user.isMfaEnabled,
      has_request_mfa_reset_link: user.has_request_mfa_reset_link,
      requested_mfa_reset_link_at: user.requested_mfa_reset_link_at,
      totpSecret: user.totpSecret,
      lastTotpTimeStep: user.lastTotpTimeStep,
    };
  }
  return null;
}

function memberIdentity(user: User): LoginIdentity {
  return {
    type: 'member',
    key: user.key,
    email: user.email,
    emailHash: user.emailHash,
    name: user.name,
    isMfaEnabled: user.isMfaEnabled,
    has_request_mfa_reset_link: user.has_request_mfa_reset_link,
    requested_mfa_reset_link_at: user.requested_mfa_reset_link_at,
    totpSecret: user.totpSecret,
    lastTotpTimeStep: user.lastTotpTimeStep,
  };
}

function superAdminIdentity(user: User): LoginIdentity {
  return {
    type: 'superAdmin',
    key: user.key,
    email: user.email,
    emailHash: user.emailHash,
    name: user.name,
    isMfaEnabled: user.isMfaEnabled,
    has_request_mfa_reset_link: user.has_request_mfa_reset_link,
    requested_mfa_reset_link_at: user.requested_mfa_reset_link_at,
    totpSecret: user.totpSecret,
    lastTotpTimeStep: user.lastTotpTimeStep,
  };
}

export async function findLoginIdentityByEmail(email: string): Promise<LoginIdentity | null> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  return user ? platformIdentity(user) : null;
}

async function getLoginIdentity(type: LoginIdentityType, key: string): Promise<LoginIdentity | null> {
  const user = await getUserById(key);
  if (!user) return null;
  if (type === 'superAdmin') return user.platform_role === 'owner' ? superAdminIdentity(user) : null;
  return user.platform_role === 'admin' || user.platform_role === 'viewer' ? memberIdentity(user) : null;
}

async function updateLoginIdentity(type: LoginIdentityType, key: string, patch: Record<string, unknown>) {
  return updateUser(key, patch as Partial<User>);
}

async function getLoginIdentityByRefreshTokenHash(refreshTokenHash: string): Promise<LoginIdentity | null> {
  const user = await getUserByRefreshTokenHash(refreshTokenHash);
  return user ? platformIdentity(user) : null;
}

export async function createAccessToken(identity: AuthIdentity | string) {
  const normalized = typeof identity === 'string'
    ? { key: identity, identityType: 'user' as const }
    : identity;
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    sub: normalized.key,
    identityType: normalized.identityType,
    iat: now,
    exp: now + 60 * 60,
  }));
  const signature = await signAccessTokenPayload(payload);
  return `vrtx_access_${payload}.${signature}`;
}

export async function verifyAccessToken(token: string): Promise<AuthIdentity | null> {
  if (!token.startsWith('vrtx_access_')) return null;
  const raw = token.slice('vrtx_access_'.length);
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = await signAccessTokenPayload(payload);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { sub?: string; identityType?: AuthIdentityType; exp?: number };
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { key: parsed.sub, identityType: parsed.identityType ?? 'user' };
  } catch {
    return null;
  }
}

export async function issueTokens(identity: LoginIdentity): Promise<SessionTokens> {
  const accessToken = await createAccessToken({ key: identity.key, identityType: identity.type });
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  await updateLoginIdentity(identity.type, identity.key, {
    refreshTokenHash,
    updatedAt: new Date().toISOString(),
  });
  return { accessToken, refreshToken };
}

export async function issueUserTokens(user: Pick<User, 'key'>): Promise<SessionTokens> {
  const accessToken = await createAccessToken({ key: user.key, identityType: 'user' });
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  await updateUser(user.key, {
    refreshTokenHash,
    updatedAt: new Date().toISOString(),
  });
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(refreshToken: string): Promise<SessionTokens | null> {
  const tokenHash = await sha256(refreshToken);
  const identity = await getLoginIdentityByRefreshTokenHash(tokenHash);
  if (identity) return issueTokens(identity);
  const user = await getUserByRefreshTokenHash(tokenHash);
  if (user) return issueUserTokens(user);
  return null;
}

export async function createChallengeTokenHash(rawToken: string) {
  return sha256(rawToken);
}

export async function createChallenge(
  identityKey: string,
  kind: 'email' | 'totp' | 'waitlist',
  ttlMs: number,
  identityType: ChallengeIdentityType = 'user',
  options: { withHandoff?: boolean } = {},
) {
  const token = randomToken(`vrtx_${kind}_`);
  const publicTokenHash = await createChallengeTokenHash(token);
  const storedTokenHash = await sha256(publicTokenHash);
  // The requesting browser's cross-device secret: parked on the same doc,
  // approved when the link is tapped, claimed once by the origin browser.
  const handoff = options.withHandoff ? await createHandoffSecret() : null;
  const expiresAt = new Date(Date.now() + ttlMs);
  await insertAuthChallenge({
    key: newId(),
    identityKey,
    identityType,
    kind,
    tokenHash: storedTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    ...(handoff ? { handoffTokenHash: handoff.storedTokenHash } : {}),
  });
  return {
    tokenHash: publicTokenHash,
    expiresAt,
    handoffTokenHash: handoff?.publicTokenHash ?? null,
  };
}

export async function consumeChallenge(tokenHash: string, kind: 'email' | 'totp' | 'waitlist') {
  const storedTokenHash = await sha256(tokenHash);
  const now = new Date();
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (
    !challenge ||
    challenge.kind !== kind ||
    challenge.consumedAt !== null ||
    new Date(challenge.expiresAt).getTime() <= now.getTime()
  ) {
    return null;
  }
  const updated = await updateAuthChallenge(challenge.key, { consumedAt: now.toISOString() });
  return {
    id: updated.key,
    identityKey: updated.identityKey,
    identityType: updated.identityType,
    userId: updated.identityType === 'user' ? updated.identityKey : undefined,
    expiresAt: new Date(updated.expiresAt),
    consumedAt: updated.consumedAt ? new Date(updated.consumedAt) : null,
    handoffTokenHash: updated.handoffTokenHash,
  };
}

export function buildMagicLink(tokenHash: string, flow: 'member' | 'user' = 'member') {
  const frontendUrl = process.env.FRONTEND_URL ?? process.env.FRONTEND_AUTH_URL ?? 'http://localhost:3000';
  const url = new URL('/public/auth/token', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('flow', flow);
  return url.toString();
}

/** Platform-role links land in the MFA biome — setup wizard or code entry. */
export function buildMfaLink(tokenHash: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? process.env.FRONTEND_AUTH_URL ?? 'http://localhost:3000';
  const url = new URL('/auth/mfa', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
  return url.toString();
}

async function deliverSignInEmail(input: { email: string; magicLink: string; expiresAt: Date }) {
  await sendBrandedEmail({
    to: input.email,
    subject: 'Your Vorinthex sign in link',
    preheader: 'Sign in to access your galaxy.',
    label: 'Sign in',
    eyebrow: 'Secure access',
    headline: 'Your galaxy awaits',
    bodyHtml: 'Sign in to access your galaxy.',
    actionUrl: input.magicLink,
    actionLabel: 'Sign in',
    supportingHtml: 'If you did not request this, you can ignore this email.',
    footerHtml: 'You received this because someone requested Vorinthex access for this email.',
    extraPayload: {
      magic_link: input.magicLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function memberGreetingName(identity: Pick<LoginIdentity, 'name' | 'email'>) {
  return escapeHtml(identity.name?.trim() || defaultNameFromEmail(identity.email) || 'there');
}

/**
 * The platform sign-in email: professional, addressed by the member's real
 * name, and explicit about the MFA step waiting behind the link.
 */
async function deliverMemberSignInEmail(input: {
  email: string;
  name: string;
  magicLink: string;
  mfaEnabled: boolean;
  expiresAt: Date;
}) {
  const mfaBody = input.mfaEnabled
    ? '<p style="margin:0;">Follow the link below to sign in with your MFA code. For your security, the link expires in 5 minutes.</p>'
    : '<p style="margin:0;">Follow the link below to set up multi-factor authentication and secure your platform access. For your security, the link expires in 5 minutes.</p>';
  await sendBrandedEmail({
    to: input.email,
    subject: input.mfaEnabled
      ? 'Your Vorinthex platform sign-in'
      : 'Set up MFA for your Vorinthex platform access',
    preheader: input.mfaEnabled
      ? 'Sign in to the Vorinthex platform with your MFA code.'
      : 'Set up multi-factor authentication to open your Vorinthex platform access.',
    label: 'Platform',
    eyebrow: 'Secure access',
    headline: input.mfaEnabled ? 'Sign in to the platform' : 'Set up your MFA',
    bodyHtml: `<p style="margin:0 0 16px;">Hi ${input.name},</p>${mfaBody}`,
    actionUrl: input.magicLink,
    actionLabel: input.mfaEnabled ? 'Sign in with MFA' : 'Set up MFA',
    supportingHtml: 'If you did not request this, you can ignore this email.',
    footerHtml: 'You received this because a sign-in was requested for your Vorinthex platform account.',
    extraPayload: {
      magic_link: input.magicLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

async function deliverMfaResetEmail(input: { email: string; name: string; magicLink: string; expiresAt: Date }) {
  await sendBrandedEmail({
    to: input.email,
    subject: 'Recover your Vorinthex MFA',
    preheader: 'Use this secure link to set up a new authenticator for Vorinthex.',
    label: 'Platform',
    eyebrow: 'MFA recovery',
    headline: 'Recover your MFA',
    bodyHtml: `<p style="margin:0 0 16px;">Hi ${input.name},</p><p style="margin:0;">Follow the link below to set up a new authenticator. Access stays locked until setup is complete, and the link expires in 5 minutes.</p>`,
    actionUrl: input.magicLink,
    actionLabel: 'Set up a new authenticator',
    supportingHtml: 'If you did not request this, you can ignore this email.',
    footerHtml: 'You received this because someone requested MFA recovery for this Vorinthex platform account.',
    extraPayload: {
      magic_link: input.magicLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

export async function requestSignInEmail(email: string) {
  const normalized = normalizeEmail(email);
  const identity = await findLoginIdentityByEmail(normalized);
  if (identity) {
    // A truthy platform_role gets the professional platform email: real
    // name, MFA-aware copy, a 5-minute link, and the /auth/mfa biome.
    const challenge = await createChallenge(identity.key, 'email', MEMBER_LINK_TTL_MS, identity.type);
    const magicLink = buildMfaLink(challenge.tokenHash);
    await deliverMemberSignInEmail({
      email: normalized,
      name: memberGreetingName(identity),
      magicLink,
      mfaEnabled: identity.isMfaEnabled,
      expiresAt: challenge.expiresAt,
    });
    trackPlatformEvent({
      slug: 'platform.sign_in_link_requested',
      userId: identity.key,
      data: {
        user_id: identity.key,
        identity_type: identity.type,
        email_hash: identity.emailHash,
        mfa_enabled: identity.isMfaEnabled,
      },
    });
    return {
      allowed: true as const,
      expiresAt: challenge.expiresAt,
    };
  }

  // Waitlist users — verified or not — sign in with the same magic-link
  // email; they get a direct session (no TOTP) that lands in their public
  // galaxy, and signing in doubles as email verification.
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  if (!user) {
    return { allowed: false as const };
  }

  const challenge = await createChallenge(user.key, 'email', EMAIL_LINK_TTL_MS, 'user', { withHandoff: true });
  const magicLink = buildMagicLink(challenge.tokenHash, 'user');
  await deliverSignInEmail({ email: normalized, magicLink, expiresAt: challenge.expiresAt });
  trackPlatformEvent({
    slug: 'auth.signin_email_sent',
    userId: user.key,
    data: { identity_type: 'user', user_id: user.key, email_hash: user.emailHash },
  });
  return {
    allowed: true as const,
    expiresAt: challenge.expiresAt,
    handoffTokenHash: challenge.handoffTokenHash,
    // The origin browser may claim for the full link TTL plus the
    // approval window after a last-second tap.
    handoffExpiresAt: new Date(challenge.expiresAt.getTime() + HANDOFF_CLAIM_WINDOW_MS),
  };
}

export async function requestMfaResetEmail(email: string) {
  const normalized = normalizeEmail(email);
  const identity = await findLoginIdentityByEmail(normalized);
  if (!identity?.isMfaEnabled) {
    return {
      ok: true as const,
      emailSent: false,
      expiresAt: new Date(Date.now() + MFA_RESET_LINK_TTL_MS),
    };
  }

  const requestedAt = new Date();
  await updateLoginIdentity(identity.type, identity.key, {
    has_request_mfa_reset_link: true,
    requested_mfa_reset_link_at: requestedAt.toISOString(),
    updatedAt: requestedAt.toISOString(),
  });

  const challenge = await createChallenge(identity.key, 'email', MFA_RESET_LINK_TTL_MS, identity.type);
  const magicLink = buildMfaLink(challenge.tokenHash);
  await deliverMfaResetEmail({
    email: normalized,
    name: memberGreetingName(identity),
    magicLink,
    expiresAt: challenge.expiresAt,
  });
  trackPlatformEvent({
    slug: 'platform.mfa_recovery_requested',
    userId: identity.key,
    data: { user_id: identity.key, email_hash: identity.emailHash },
  });
  return {
    ok: true as const,
    emailSent: true,
    expiresAt: challenge.expiresAt,
  };
}

export async function validateMagicLink(token: string, explorerId?: string): Promise<MagicLinkValidationResult | null> {
  const emailChallenge = await consumeChallenge(token, 'email');
  if (!emailChallenge) return null;

  if (emailChallenge.identityType === 'user') {
    const user = await getUserById(emailChallenge.identityKey);
    if (!user) return null;
    // The tap proves inbox ownership: wake the browser that requested the
    // link, wherever this one happens to be running.
    await approveHandoff({ key: emailChallenge.id, handoffTokenHash: emailChallenge.handoffTokenHash });
    const tokens = await issueUserTokens(user);
    // Signing in proves inbox ownership — it verifies the email too.
    const wasUnverified = !user.isVerified;
    await updateUser(user.key, {
      isVerified: true,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // Fragments collected anonymously (as this browser's explorerId) since
    // the last adoption — at join, or never, for a returning explorer who
    // kept exploring signed out — merge into the account on every sign in,
    // not just the first one.
    if (explorerId) {
      const adopted = await adoptExplorerFragments(explorerId, user.key);
      if (adopted > 0) notifyCountersDirty();
    }
    const alias = user.alias ?? generateAlias(user.key);
    trackPlatformEvent({
      slug: 'auth.magic_link_authenticated',
      userId: user.key,
      data: { user_id: user.key, email_hash: user.emailHash },
    });
    if (wasUnverified) {
      trackPlatformEvent({
        slug: 'waitlist.email_verified',
        userId: user.key,
        data: { user_id: user.key, email_hash: user.emailHash, via: 'signin' },
      });
      notifyCountersDirty();
    }
    return {
      status: 'authenticated',
      identity: { key: user.key, identityType: 'user' },
      ...tokens,
      alias,
      aliasSlug: user.alias_slug,
      waitlistNumber: user.waitlistNumber,
      welcomeLine: pickWelcomeLine(user.key, alias),
    };
  }

  const auth = await getLoginIdentity(emailChallenge.identityType, emailChallenge.identityKey);
  if (!auth) return null;

  const totpChallenge = await createChallenge(auth.key, 'totp', TOTP_CHALLENGE_TTL_MS, auth.type);
  return {
    status: auth.has_request_mfa_reset_link ? 'totp_setup_required' : auth.isMfaEnabled ? 'totp_required' : 'totp_setup_required',
    totpChallengeToken: totpChallenge.tokenHash,
    expiresAt: totpChallenge.expiresAt,
  };
}

export async function createUserWithAuth(input: { email: string; name?: string; profile_url?: string }) {
  const normalized = normalizeEmail(input.email);
  const user = await upsertUserByEmail(normalized, {
    name: input.name ?? defaultNameFromEmail(normalized),
    profileUrl: input.profile_url ?? null,
  });
  return { userId: user.key };
}

export async function startTotpSetup(challengeToken: string) {
  const challenge = await consumeChallenge(challengeToken, 'totp');
  if (!challenge || challenge.identityType === 'user') return null;
  const identity = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!identity || (identity.isMfaEnabled && !identity.has_request_mfa_reset_link)) return null;

  const secret = generateSecret();
  await updateLoginIdentity(identity.type, identity.key, {
    totpSecret: await encryptSecret(secret),
    isMfaEnabled: false,
    lastTotpTimeStep: null,
    updatedAt: new Date().toISOString(),
  });

  const otpauthUrl = generateURI({ issuer: ISSUER, label: identity.email, secret });
  trackPlatformEvent({
    slug: 'platform.mfa_setup_started',
    userId: identity.key,
    data: { user_id: identity.key, email_hash: identity.emailHash },
  });
  return {
    setupChallengeToken: (await createChallenge(identity.key, 'totp', TOTP_CHALLENGE_TTL_MS, identity.type)).tokenHash,
    secret,
    otpauthUrl,
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1 }),
  };
}

export async function verifySuccessiveTotpCodes(secret: string, codes: [string, string], epoch = Date.now() / 1000) {
  const first = await verifyTotpToken({
    token: codes[0],
    secret,
    crypto: otpCrypto,
    base32,
    period: TOTP_PERIOD_SECONDS,
    epoch,
    epochTolerance: TOTP_PERIOD_SECONDS,
  });
  if (!first.valid) return null;
  const second = await verifyTotpToken({
    token: codes[1],
    secret,
    crypto: otpCrypto,
    base32,
    period: TOTP_PERIOD_SECONDS,
    epoch,
    epochTolerance: TOTP_PERIOD_SECONDS,
    afterTimeStep: first.timeStep,
  });
  if (!second.valid) return null;
  return second.timeStep;
}

export async function completeTotpSetup(challengeToken: string, codes: [string, string]) {
  const challenge = await consumeChallenge(challengeToken, 'totp');
  if (!challenge || challenge.identityType === 'user') return { ok: false as const, error: 'invalid challenge' };
  const auth = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!auth?.totpSecret) return { ok: false as const, error: 'setup unavailable' };
  if (auth.has_request_mfa_reset_link) {
    if (!hasUsableMfaResetRequest(auth)) {
      return { ok: false as const, error: 'mfa reset link expired; request a new reset link' };
    }
  } else if (auth.isMfaEnabled) {
    return { ok: false as const, error: 'setup unavailable' };
  }

  const lastTimeStep = await verifySuccessiveTotpCodes(await decryptSecret(auth.totpSecret), codes);
  if (!lastTimeStep) return { ok: false as const, error: 'invalid totp codes' };

  await updateLoginIdentity(auth.type, auth.key, {
    isMfaEnabled: true,
    has_request_mfa_reset_link: false,
    requested_mfa_reset_link_at: null,
    lastLoginAt: new Date().toISOString(),
    lastTotpTimeStep: lastTimeStep,
    updatedAt: new Date().toISOString(),
  });
  trackPlatformEvent({
    slug: 'platform.mfa_enabled',
    userId: auth.key,
    data: { user_id: auth.key, email_hash: auth.emailHash },
  });

  return {
    ok: true as const,
    identity: { key: auth.key, identityType: auth.type },
    name: auth.name,
    ...(await issueTokens(auth)),
  };
}

export async function verifyTotpAndIssueSession(challengeToken: string, code: string) {
  const challenge = await consumeChallenge(challengeToken, 'totp');
  if (!challenge || challenge.identityType === 'user') return null;
  const auth = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!auth?.totpSecret || !auth.isMfaEnabled) return null;

  const result = await verifyTotpToken({
    token: code,
    secret: await decryptSecret(auth.totpSecret),
    crypto: otpCrypto,
    base32,
    period: TOTP_PERIOD_SECONDS,
    epochTolerance: TOTP_PERIOD_SECONDS,
    afterTimeStep: auth.lastTotpTimeStep ?? undefined,
  });
  if (!result.valid) return null;

  await updateLoginIdentity(auth.type, auth.key, {
    lastLoginAt: new Date().toISOString(),
    lastTotpTimeStep: result.timeStep,
    updatedAt: new Date().toISOString(),
  });
  trackPlatformEvent({
    slug: 'platform.mfa_verified',
    userId: auth.key,
    data: { user_id: auth.key, email_hash: auth.emailHash },
  });

  return {
    identity: { key: auth.key, identityType: auth.type },
    name: auth.name,
    ...(await issueTokens(auth)),
  };
}
