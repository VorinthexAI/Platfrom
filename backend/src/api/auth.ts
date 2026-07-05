import { getAuthChallengeByTokenHash, insertAuthChallenge, updateAuthChallenge } from '@/lib/db/auth-challenges.node';
import {
  getMemberByEmail,
  getMemberByRefreshTokenHash,
  getMemberByUserId,
  updateMember,
} from '@/lib/db/members.node';
import { getUserById, updateUser } from '@/lib/db/users.node';
import { decryptSecret, encryptSecret, randomToken, sha256, timingSafeEqual } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { verify as verifyTotpToken } from '@otplib/totp';
import { base32 } from '@otplib/plugin-base32-scure';
import { crypto as otpCrypto } from '@otplib/plugin-crypto-noble';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { sendBrandedEmail } from './email';
import { defaultNameFromEmail, normalizeEmail, upsertMemberForUser, upsertUserByEmail } from './users';

const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;
const TOTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MFA_RESET_LINK_TTL_MS = 15 * 60 * 1000;
const TOTP_PERIOD_SECONDS = 30;
const ISSUER = 'Vorinthex';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export type MagicLinkValidationResult =
  | { status: 'totp_setup_required'; totpChallengeToken: string; expiresAt: Date }
  | { status: 'totp_required'; totpChallengeToken: string; expiresAt: Date };

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

export async function createAccessToken(userId: string) {
  const payload = base64UrlEncode(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  }));
  const signature = await signAccessTokenPayload(payload);
  return `vrtx_access_${payload}.${signature}`;
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  if (!token.startsWith('vrtx_access_')) return null;
  const raw = token.slice('vrtx_access_'.length);
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = await signAccessTokenPayload(payload);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { sub?: string; exp?: number };
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}

export async function issueTokens(userId: string): Promise<SessionTokens> {
  const accessToken = await createAccessToken(userId);
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  const member = await getMemberByUserId(userId);
  if (!member) throw new Error('cannot issue tokens for non-member user');
  await updateMember(member.key, { refreshTokenHash, updatedAt: new Date().toISOString() });
  await updateUser(userId, { refreshTokenHash, updatedAt: new Date().toISOString() });
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(refreshToken: string): Promise<SessionTokens | null> {
  const tokenHash = await sha256(refreshToken);
  const member = await getMemberByRefreshTokenHash(tokenHash);
  if (!member) return null;
  return issueTokens(member.userId);
}

export async function createChallengeTokenHash(rawToken: string) {
  return sha256(rawToken);
}

export async function createChallenge(userId: string, kind: 'email' | 'totp' | 'waitlist', ttlMs: number) {
  const token = randomToken(`vrtx_${kind}_`);
  const publicTokenHash = await createChallengeTokenHash(token);
  const storedTokenHash = await sha256(publicTokenHash);
  const expiresAt = new Date(Date.now() + ttlMs);
  await insertAuthChallenge({
    key: newId(),
    userId,
    kind,
    tokenHash: storedTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });
  return { tokenHash: publicTokenHash, expiresAt };
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
    userId: updated.userId,
    expiresAt: new Date(updated.expiresAt),
    consumedAt: updated.consumedAt ? new Date(updated.consumedAt) : null,
  };
}

export function buildMagicLink(tokenHash: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? process.env.FRONTEND_AUTH_URL ?? 'http://localhost:3000';
  const url = new URL('/public/auth/token', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
  return url.toString();
}

async function deliverSignInEmail(input: { email: string; magicLink: string; expiresAt: Date }) {
  await sendBrandedEmail({
    to: input.email,
    subject: 'Your Vorinthex sign-in link',
    preheader: 'Use this secure link to continue signing in to Vorinthex.',
    label: 'Sign in',
    eyebrow: 'Secure access',
    headline: 'Continue to Vorinthex',
    bodyHtml: 'Use this magic link to continue signing in. You will still need to complete TOTP verification before a session is issued.',
    actionUrl: input.magicLink,
    actionLabel: 'Continue sign-in',
    supportingHtml: `This sign-in link expires at ${input.expiresAt.toISOString()}.`,
    footerHtml: 'You received this because someone requested a Vorinthex sign-in link for this email address.',
    extraPayload: {
      magic_link: input.magicLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

async function deliverMfaResetEmail(input: { email: string; magicLink: string; expiresAt: Date }) {
  await sendBrandedEmail({
    to: input.email,
    subject: 'Reset your Vorinthex authenticator',
    preheader: 'Use this secure link to set up a new authenticator for Vorinthex.',
    label: 'Security',
    eyebrow: 'MFA reset',
    headline: 'Reset your authenticator',
    bodyHtml: 'Use this magic link to start setting up a new authenticator. A session will not be issued until setup is completed.',
    actionUrl: input.magicLink,
    actionLabel: 'Reset authenticator',
    supportingHtml: `This reset link expires at ${input.expiresAt.toISOString()}.`,
    footerHtml: 'You received this because someone requested an MFA reset for this Vorinthex account.',
    extraPayload: {
      magic_link: input.magicLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

export async function requestSignInEmail(email: string) {
  const normalized = normalizeEmail(email);
  const member = await getMemberByEmail(normalized);
  if (!member) {
    return { allowed: false as const };
  }

  const challenge = await createChallenge(member.userId, 'email', EMAIL_LINK_TTL_MS);
  const magicLink = buildMagicLink(challenge.tokenHash);
  await deliverSignInEmail({ email: normalized, magicLink, expiresAt: challenge.expiresAt });
  return {
    allowed: true as const,
    expiresAt: challenge.expiresAt,
  };
}

export async function requestMfaResetEmail(email: string) {
  const normalized = normalizeEmail(email);
  const member = await getMemberByEmail(normalized);
  if (!member?.isMfaEnabled) {
    return {
      ok: true as const,
      emailSent: false,
      expiresAt: new Date(Date.now() + MFA_RESET_LINK_TTL_MS),
    };
  }

  const requestedAt = new Date();
  await updateMember(member.key, {
    has_request_mfa_reset_link: true,
    requested_mfa_reset_link_at: requestedAt.toISOString(),
    updatedAt: requestedAt.toISOString(),
  });

  const challenge = await createChallenge(member.userId, 'email', MFA_RESET_LINK_TTL_MS);
  const magicLink = buildMagicLink(challenge.tokenHash);
  await deliverMfaResetEmail({ email: normalized, magicLink, expiresAt: challenge.expiresAt });
  return {
    ok: true as const,
    emailSent: true,
    expiresAt: challenge.expiresAt,
  };
}

export async function validateMagicLink(token: string): Promise<MagicLinkValidationResult | null> {
  const emailChallenge = await consumeChallenge(token, 'email');
  if (!emailChallenge) return null;

  await updateUser(emailChallenge.userId, { isVerified: true, updatedAt: new Date().toISOString() });

  const auth = await getMemberByUserId(emailChallenge.userId);
  if (!auth) return null;

  const totpChallenge = await createChallenge(emailChallenge.userId, 'totp', TOTP_CHALLENGE_TTL_MS);
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
  await upsertMemberForUser(user);
  return { userId: user.key };
}

export async function startTotpSetup(challengeToken: string) {
  const challenge = await consumeChallenge(challengeToken, 'totp');
  if (!challenge) return null;
  const user = await getUserById(challenge.userId);
  const member = await getMemberByUserId(challenge.userId);
  if (!user || !member || (member.isMfaEnabled && !member.has_request_mfa_reset_link)) return null;

  const secret = generateSecret();
  await updateMember(member.key, {
    totpSecret: await encryptSecret(secret),
    isMfaEnabled: false,
    lastTotpTimeStep: null,
    updatedAt: new Date().toISOString(),
  });

  const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
  return {
    setupChallengeToken: (await createChallenge(challenge.userId, 'totp', TOTP_CHALLENGE_TTL_MS)).tokenHash,
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
  if (!challenge) return { ok: false as const, error: 'invalid challenge' };
  const auth = await getMemberByUserId(challenge.userId);
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

  await updateMember(auth.key, {
    isMfaEnabled: true,
    has_request_mfa_reset_link: false,
    requested_mfa_reset_link_at: null,
    lastLoginAt: new Date().toISOString(),
    lastTotpTimeStep: lastTimeStep,
    updatedAt: new Date().toISOString(),
  });
  await updateUser(challenge.userId, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { ok: true as const, userId: challenge.userId, ...(await issueTokens(challenge.userId)) };
}

export async function verifyTotpAndIssueSession(challengeToken: string, code: string) {
  const challenge = await consumeChallenge(challengeToken, 'totp');
  if (!challenge) return null;
  const auth = await getMemberByUserId(challenge.userId);
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

  await updateMember(auth.key, {
    lastLoginAt: new Date().toISOString(),
    lastTotpTimeStep: result.timeStep,
    updatedAt: new Date().toISOString(),
  });
  await updateUser(challenge.userId, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return { userId: challenge.userId, ...(await issueTokens(challenge.userId)) };
}
