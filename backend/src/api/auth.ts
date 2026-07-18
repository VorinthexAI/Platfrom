import {
  consumeAuthChallengeByTokenHash,
  getAuthChallengeByTokenHash,
  insertAuthChallenge,
  type authIdentityTypeSchema,
} from '@/lib/db/auth-challenges.node';
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
import { getOrganizationById } from '@/lib/db/organizations.node';
import {
  listActiveUserOrganizationsByUser,
  updateUserOrganization,
  type UserOrganization,
} from '@/lib/db/user-organization.node';
import { generateAlias, pickWelcomeLine } from '@/lib/alias';
import { trackPlatformEvent } from '@/platform/events';
import { approveHandoff, createHandoffSecret, HANDOFF_CLAIM_WINDOW_MS } from './auth-handoff';
import { notifyCountersDirty } from './live-bus';

const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;
const TOTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const TOTP_PERIOD_SECONDS = 30;
const ISSUER = 'Vorinthex';
export const STANDARD_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const STANDARD_REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const FOUNDER_ACCESS_MAX_AGE_SECONDS = 60 * 15;
export const FOUNDER_REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenMaxAgeSeconds: number;
  refreshTokenMaxAgeSeconds: number;
  sessionExpiresAt: string;
}

export type AuthIdentityType = 'user' | 'member' | 'superAdmin';
export type LoginIdentityType = Exclude<AuthIdentityType, 'user'>;
export type OAuthProvider = 'google' | 'apple';

export interface AuthIdentity {
  key: string;
  identityType: AuthIdentityType;
}

interface LoginIdentity {
  type: LoginIdentityType;
  key: string;
  linkKey: string;
  organizationId: string;
  orgRole: UserOrganization['orgRole'];
  email: string;
  emailHash: string;
  name: string | null;
  organizationTitle: string | null;
  organizationIsRoot: boolean;
  organizationMfaEnabled: boolean;
  isMfaEnabled: boolean;
  totpSecret: string | null;
  lastTotpTimeStep: number | null;
}

type ChallengeIdentityType = typeof authIdentityTypeSchema._type;

export type TotpChallengeValidationResult =
  | { status: 'totp_setup_required'; totpChallengeToken: string; expiresAt: Date }
  | { status: 'totp_required'; totpChallengeToken: string; expiresAt: Date };

export type MagicLinkValidationResult =
  | TotpChallengeValidationResult
  | ({
    status: 'authenticated';
    identity: AuthIdentity;
    alias: string;
    aliasSlug: string | null;
    waitlistNumber: number | null;
    welcomeLine: string;
  } & SessionTokens);

export function hasUsableMfaResetRequest() {
  return false;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlEncodeBytes(value: Uint8Array | ArrayBuffer) {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function jsonBase64Url(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

async function signAccessTokenPayload(payload: string) {
  return sha256(`${payload}.${process.env.ACCESS_TOKEN_SECRET || 'dev-access-token-secret'}`);
}

async function createSignedOAuthState(provider: OAuthProvider) {
  const payload = jsonBase64Url({
    provider,
    nonce: randomToken('oauth_'),
    exp: Date.now() + 10 * 60 * 1000,
  });
  return `${payload}.${await signAccessTokenPayload(payload)}`;
}

async function verifySignedOAuthState(provider: OAuthProvider, state: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  const expected = await signAccessTokenPayload(payload);
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { provider?: string; exp?: number };
    return parsed.provider === provider && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

async function membershipIdentity(
  user: User,
  membership: UserOrganization,
): Promise<LoginIdentity | null> {
  const organization = await getOrganizationById(membership.organizationId);
  if (!organization?.isActive) return null;
  return {
    type: loginIdentityTypeForMembership(membership.orgRole, organization.is_root),
    key: user.key,
    linkKey: membership.key,
    organizationId: membership.organizationId,
    orgRole: membership.orgRole,
    email: user.email,
    emailHash: user.emailHash,
    name: user.name,
    organizationTitle: membership.orgTitle,
    organizationIsRoot: organization.is_root,
    organizationMfaEnabled: organization.mfa_enabled,
    isMfaEnabled: membership.isMfaEnabled,
    totpSecret: membership.totpSecret,
    lastTotpTimeStep: membership.lastTotpTimeStep,
  };
}

export function loginIdentityTypeForMembership(orgRole: UserOrganization['orgRole'], organizationIsRoot: boolean): LoginIdentityType {
  return orgRole === 'owner' && organizationIsRoot ? 'superAdmin' : 'member';
}

const membershipRoleRank: Record<UserOrganization['orgRole'], number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 2,
  viewer: 1,
};

function strongestMembership(
  memberships: UserOrganization[],
): UserOrganization | null {
  return memberships.reduce<UserOrganization | null>((best, membership) => {
    if (!best || membershipRoleRank[membership.orgRole] > membershipRoleRank[best.orgRole]) return membership;
    return best;
  }, null);
}

async function organizationMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const membership = strongestMembership(await listActiveUserOrganizationsByUser(user.key));
  return membership ? membershipIdentity(user, membership) : null;
}

async function rootOrganizationMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const memberships = await listActiveUserOrganizationsByUser(user.key);
  for (const membership of memberships) {
    const identity = await membershipIdentity(user, membership);
    if (identity?.organizationIsRoot) return identity;
  }
  return null;
}

/**
 * Whether ANY of the user's active memberships belongs to an organization
 * that enforces MFA. `organization.mfa_enabled` is the single source of
 * truth for that decision — `is_root` only routes WHICH sign-in front door
 * is used (founders gate vs the regular TOTP flow), never whether MFA is
 * required. Prefers a root membership so founders always land on their
 * gate.
 */
async function mfaEnforcedMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const memberships = await listActiveUserOrganizationsByUser(user.key);
  let enforced: LoginIdentity | null = null;
  for (const membership of memberships) {
    const identity = await membershipIdentity(user, membership);
    if (!identity?.organizationMfaEnabled) continue;
    if (identity.organizationIsRoot) return identity;
    enforced ??= identity;
  }
  return enforced;
}

export async function findLoginIdentityByEmail(email: string): Promise<LoginIdentity | null> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  if (!user) return null;
  return organizationMembershipIdentity(user);
}

async function getLoginIdentity(type: LoginIdentityType, key: string): Promise<LoginIdentity | null> {
  const user = await getUserById(key);
  if (!user) return null;
  const memberships = await listActiveUserOrganizationsByUser(user.key);
  const identities = (await Promise.all(memberships.map((membership) => membershipIdentity(user, membership))))
    .filter((identity): identity is LoginIdentity => identity?.type === type)
    .sort((left, right) => membershipRoleRank[right.orgRole] - membershipRoleRank[left.orgRole]);
  return identities[0] ?? null;
}

async function updateLoginIdentity(type: LoginIdentityType, key: string, patch: Record<string, unknown>) {
  const identity = await getLoginIdentity(type, key);
  if (!identity) return null;
  return updateUserOrganization(identity.linkKey, patch as Partial<UserOrganization>);
}

export function getAuthSessionPolicy(identityType: AuthIdentityType) {
  return identityType === 'superAdmin'
    ? { accessMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS }
    : { accessMaxAgeSeconds: STANDARD_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: STANDARD_REFRESH_MAX_AGE_SECONDS };
}

export async function createAccessToken(identity: AuthIdentity | string, sessionExpiresAt?: Date) {
  const normalized = typeof identity === 'string'
    ? { key: identity, identityType: 'user' as const }
    : identity;
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getAuthSessionPolicy(normalized.identityType).accessMaxAgeSeconds;
  const sessionExpiry = sessionExpiresAt ? Math.floor(sessionExpiresAt.getTime() / 1000) : now + ttlSeconds;
  const payload = base64UrlEncode(JSON.stringify({
    sub: normalized.key,
    identityType: normalized.identityType,
    iat: now,
    exp: Math.min(now + ttlSeconds, sessionExpiry),
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
    if (!parsed.sub || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { key: parsed.sub, identityType: parsed.identityType ?? 'user' };
  } catch {
    return null;
  }
}

export async function issueTokens(identity: LoginIdentity, sessionExpiresAt?: Date): Promise<SessionTokens> {
  const policy = getAuthSessionPolicy(identity.type);
  const issuedAt = Date.now();
  sessionExpiresAt ??= new Date(issuedAt + policy.refreshMaxAgeSeconds * 1000);
  const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt) / 1000));
  const accessToken = await createAccessToken({ key: identity.key, identityType: identity.type }, sessionExpiresAt);
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  await updateUser(identity.key, {
    refreshTokenHash,
    refreshTokenExpiresAt: sessionExpiresAt.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { accessToken, refreshToken, accessTokenMaxAgeSeconds: Math.min(policy.accessMaxAgeSeconds, remainingSeconds), refreshTokenMaxAgeSeconds: remainingSeconds, sessionExpiresAt: sessionExpiresAt.toISOString() };
}

export async function issueUserTokens(user: Pick<User, 'key'>, sessionExpiresAt?: Date): Promise<SessionTokens> {
  const policy = getAuthSessionPolicy('user');
  const issuedAt = Date.now();
  sessionExpiresAt ??= new Date(issuedAt + policy.refreshMaxAgeSeconds * 1000);
  const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt) / 1000));
  const accessToken = await createAccessToken({ key: user.key, identityType: 'user' }, sessionExpiresAt);
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  await updateUser(user.key, {
    refreshTokenHash,
    refreshTokenExpiresAt: sessionExpiresAt.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { accessToken, refreshToken, accessTokenMaxAgeSeconds: Math.min(policy.accessMaxAgeSeconds, remainingSeconds), refreshTokenMaxAgeSeconds: remainingSeconds, sessionExpiresAt: sessionExpiresAt.toISOString() };
}

export async function rotateRefreshToken(refreshToken: string): Promise<SessionTokens | null> {
  const tokenHash = await sha256(refreshToken);
  const user = await getUserByRefreshTokenHash(tokenHash);
  if (!user || !isRefreshTokenActive(user.refreshTokenExpiresAt)) return null;
  const identity = await organizationMembershipIdentity(user);
  const identityType = identity?.type ?? 'user';
  const policy = getAuthSessionPolicy(identityType);
  const sessionExpiresAt = new Date(Math.min(
    Date.parse(user.refreshTokenExpiresAt!),
    Date.now() + policy.refreshMaxAgeSeconds * 1000,
  ));
  return identity ? issueTokens(identity, sessionExpiresAt) : issueUserTokens(user, sessionExpiresAt);
}

export function isRefreshTokenActive(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
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

export async function createTotpChallengeForIdentity(
  identityType: LoginIdentityType,
  identityKey: string,
): Promise<TotpChallengeValidationResult | null> {
  const auth = await getLoginIdentity(identityType, identityKey);
  if (!auth) return null;

  const totpChallenge = await createChallenge(auth.key, 'totp', TOTP_CHALLENGE_TTL_MS, auth.type);
  return {
    status: auth.isMfaEnabled ? 'totp_required' : 'totp_setup_required',
    totpChallengeToken: totpChallenge.tokenHash,
    expiresAt: totpChallenge.expiresAt,
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
  const updated = await consumeAuthChallengeByTokenHash(storedTokenHash, kind, now.toISOString());
  if (!updated) return null;
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

/** Keeps a challenge retryable until its proof succeeds, then claims it once. */
export async function acceptVerifiedChallenge<T>(
  verify: () => Promise<T | null>,
  consume: () => Promise<boolean>,
): Promise<T | null> {
  const verified = await verify();
  if (verified === null) return null;
  return await consume() ? verified : null;
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

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function buildOAuthAuthorizationUrl(provider: OAuthProvider, redirectUri: string) {
  const state = await createSignedOAuthState(provider);
  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', requiredEnv('GOOGLE_OAUTH_CLIENT_ID'));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.searchParams.set('client_id', requiredEnv('APPLE_OAUTH_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'name email');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('state', state);
  return url.toString();
}

function formBody(input: Record<string, string>) {
  return new URLSearchParams(input).toString();
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pemBodyToArrayBuffer(pem: string) {
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  return Buffer.from(body, 'base64');
}

async function buildAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'ES256',
    kid: requiredEnv('APPLE_OAUTH_KEY_ID'),
  };
  const payload = {
    iss: requiredEnv('APPLE_OAUTH_TEAM_ID'),
    iat: now,
    exp: now + 60 * 60 * 24 * 30,
    aud: 'https://appleid.apple.com',
    sub: requiredEnv('APPLE_OAUTH_CLIENT_ID'),
  };
  const signingInput = `${jsonBase64Url(header)}.${jsonBase64Url(payload)}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemBodyToArrayBuffer(requiredEnv('APPLE_OAUTH_PRIVATE_KEY')),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`;
}

async function exchangeGoogleCode(code: string, redirectUri: string) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      code,
      client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
  if (!tokenResponse.ok || !tokenData?.access_token) return null;
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileResponse.json().catch(() => null) as { email?: string; name?: string; picture?: string; email_verified?: boolean } | null;
  if (!profileResponse.ok || !profile?.email || profile.email_verified === false) return null;
  return { email: profile.email, name: profile.name ?? null, profileUrl: profile.picture ?? null };
}

async function exchangeAppleCode(code: string, redirectUri: string) {
  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      code,
      client_id: requiredEnv('APPLE_OAUTH_CLIENT_ID'),
      client_secret: await buildAppleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => null) as { id_token?: string } | null;
  if (!tokenResponse.ok || !tokenData?.id_token) return null;
  const payload = decodeJwtPayload(tokenData.id_token);
  if (!payload) return null;
  const email = typeof payload?.email === 'string' ? payload.email : null;
  if (!email || payload.email_verified === false || payload.email_verified === 'false') return null;
  return { email, name: null, profileUrl: null };
}

export async function completeOAuthSignIn(input: {
  provider: OAuthProvider;
  code: string;
  state: string;
  redirectUri: string;
}) {
  if (!await verifySignedOAuthState(input.provider, input.state)) return null;
  const profile = input.provider === 'google'
    ? await exchangeGoogleCode(input.code, input.redirectUri)
    : await exchangeAppleCode(input.code, input.redirectUri);
  if (!profile) return null;
  const normalized = normalizeEmail(profile.email);

  // Members of MFA-enforcing organizations never get a session through
  // OAuth — a provider click can't be allowed to skip the TOTP gate.
  // The decision is organization.mfa_enabled (the root organization has
  // it set true); is_root only picks which front door they're sent to.
  const existingUser = await getUserByEmailHash(await hashUserEmail(normalized));
  const enforced = existingUser ? await mfaEnforcedMembershipIdentity(existingUser) : null;
  if (enforced?.organizationIsRoot) {
    return { status: 'founders_gate_required' as const };
  }
  if (enforced) {
    return { status: 'mfa_required' as const };
  }

  const user = await upsertUserByEmail(normalized, {
    name: profile.name ?? defaultNameFromEmail(normalized),
    profileUrl: profile.profileUrl,
    isVerified: true,
    lastLoginAt: new Date().toISOString(),
  });
  const tokens = await issueUserTokens(user);
  const alias = user.alias ?? generateAlias(user.key);
  trackPlatformEvent({
    slug: 'auth.magic_link_authenticated',
    userId: user.key,
    data: {
      user_id: user.key,
      email_hash: user.emailHash,
      provider: input.provider,
      via: 'oauth',
    },
  });
  return {
    status: 'authenticated' as const,
    identity: { key: user.key, identityType: 'user' as const },
    ...tokens,
    alias,
    aliasSlug: user.alias_slug,
    waitlistNumber: user.waitlistNumber,
    welcomeLine: pickWelcomeLine(user.key, alias),
  };
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
    // Routing only: root members sign in through the founders gate. The
    // MFA *requirement* itself is organization.mfa_enabled (true on the
    // root organization), checked below for every other organization.
    if (identity.organizationIsRoot) {
      trackPlatformEvent({
        slug: 'platform.sign_in_link_requested',
        userId: identity.key,
        data: {
          user_id: identity.key,
          identity_type: identity.type,
          email_hash: identity.emailHash,
          delivery: 'founders_gate_required',
        },
      });
      return {
        allowed: false as const,
        foundersGateRequired: true as const,
      };
    }
    if (identity.organizationMfaEnabled) {
      const challenge = await createTotpChallengeForIdentity(identity.type, identity.key);
      if (!challenge) return { allowed: false as const };
      trackPlatformEvent({
        slug: 'platform.sign_in_link_requested',
        userId: identity.key,
        data: {
          user_id: identity.key,
          identity_type: identity.type,
          email_hash: identity.emailHash,
          mfa_enabled: true,
          delivery: 'direct_challenge',
        },
      });
      return {
        allowed: true as const,
        organizationMfaRequired: true as const,
        status: challenge.status,
        totpChallengeToken: challenge.totpChallengeToken,
        expiresAt: challenge.expiresAt,
        name: identity.name,
        organizationTitle: identity.organizationTitle,
      };
    }

    const challenge = await createChallenge(identity.key, 'email', EMAIL_LINK_TTL_MS, identity.type, { withHandoff: true });
    const magicLink = buildMagicLink(challenge.tokenHash, 'member');
    await deliverMemberSignInEmail({
      email: normalized,
      name: memberGreetingName(identity),
      magicLink,
      mfaEnabled: false,
      expiresAt: challenge.expiresAt,
    });
    trackPlatformEvent({
      slug: 'platform.sign_in_link_requested',
      userId: identity.key,
      data: {
        user_id: identity.key,
        identity_type: identity.type,
        email_hash: identity.emailHash,
        mfa_enabled: false,
      },
    });
    return {
      allowed: true as const,
      expiresAt: challenge.expiresAt,
      handoffTokenHash: challenge.handoffTokenHash,
      handoffExpiresAt: new Date(challenge.expiresAt.getTime() + HANDOFF_CLAIM_WINDOW_MS),
    };
  }

  // Waitlist users — verified or not — sign in with the same magic-link
  // email; they get a direct session (no TOTP) that lands in their public
  // galaxy, and signing in doubles as email verification.
  const existingUser = await getUserByEmailHash(await hashUserEmail(normalized));
  const user = existingUser ?? await upsertUserByEmail(normalized, {
    name: defaultNameFromEmail(normalized),
    profileUrl: null,
  });

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
  const identity = await findLoginIdentityByEmail(email);
  return {
    ok: true as const,
    emailSent: Boolean(identity?.isMfaEnabled),
    expiresAt: new Date(Date.now() + TOTP_CHALLENGE_TTL_MS),
  };
}

export async function requestFoundersGate(email: string) {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  if (!user) return { allowed: false as const };
  const identity = await rootOrganizationMembershipIdentity(user);
  if (!identity) return { allowed: false as const };
  const challenge = await createTotpChallengeForIdentity(identity.type, identity.key);
  if (!challenge) return { allowed: false as const };
  trackPlatformEvent({
    slug: 'platform.sign_in_link_requested',
    userId: identity.key,
    data: {
      user_id: identity.key,
      identity_type: identity.type,
      email_hash: identity.emailHash,
      delivery: 'founders_gate',
    },
  });
  return {
    allowed: true as const,
    status: challenge.status,
    totpChallengeToken: challenge.totpChallengeToken,
    expiresAt: challenge.expiresAt,
    name: identity.name,
    organizationTitle: identity.organizationTitle,
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
  await approveHandoff({ key: emailChallenge.id, handoffTokenHash: emailChallenge.handoffTokenHash });
  if (auth.organizationMfaEnabled) {
    return createTotpChallengeForIdentity(emailChallenge.identityType, emailChallenge.identityKey);
  }
  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  trackPlatformEvent({
    slug: 'auth.magic_link_authenticated',
    userId: auth.key,
    data: { user_id: auth.key, email_hash: auth.emailHash, identity_type: auth.type },
  });
  return {
    status: 'authenticated',
    identity: { key: auth.key, identityType: auth.type },
    ...(await issueTokens(auth)),
    alias: auth.name ?? defaultNameFromEmail(auth.email) ?? auth.email,
    aliasSlug: null,
    waitlistNumber: null,
    welcomeLine: `Welcome back${auth.name ? `, ${auth.name}` : ''}.`,
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
  if (!identity || identity.isMfaEnabled) return null;

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

export async function resetTotpForChallenge(challengeToken: string) {
  const storedTokenHash = await sha256(challengeToken);
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (
    !challenge ||
    challenge.kind !== 'totp' ||
    challenge.identityType === 'user' ||
    challenge.consumedAt !== null ||
    new Date(challenge.expiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  const identity = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!identity) return null;
  await updateLoginIdentity(identity.type, identity.key, {
    isMfaEnabled: false,
    totpSecret: null,
    lastTotpTimeStep: null,
    updatedAt: new Date().toISOString(),
  });
  return startTotpSetup(challengeToken);
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
  const storedTokenHash = await sha256(challengeToken);
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (
    !challenge ||
    challenge.kind !== 'totp' ||
    challenge.identityType === 'user' ||
    challenge.consumedAt !== null ||
    new Date(challenge.expiresAt).getTime() <= Date.now()
  ) {
    return { ok: false as const, error: 'invalid challenge' };
  }
  const auth = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!auth?.totpSecret) return { ok: false as const, error: 'setup unavailable' };
  if (auth.isMfaEnabled) {
    return { ok: false as const, error: 'setup unavailable' };
  }

  const lastTimeStep = await acceptVerifiedChallenge(
    async () => verifySuccessiveTotpCodes(await decryptSecret(auth.totpSecret!), codes),
    async () => Boolean(await consumeAuthChallengeByTokenHash(
      storedTokenHash,
      'totp',
      new Date().toISOString(),
    )),
  );
  if (!lastTimeStep) return { ok: false as const, error: 'invalid totp codes' };

  await updateLoginIdentity(auth.type, auth.key, {
    isMfaEnabled: true,
    lastTotpTimeStep: lastTimeStep,
    updatedAt: new Date().toISOString(),
  });
  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
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
    organizationTitle: auth.organizationTitle,
    ...(await issueTokens(auth)),
  };
}

export async function verifyTotpAndIssueSession(challengeToken: string, code: string) {
  const storedTokenHash = await sha256(challengeToken);
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (
    !challenge ||
    challenge.kind !== 'totp' ||
    challenge.identityType === 'user' ||
    challenge.consumedAt !== null ||
    new Date(challenge.expiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  const auth = await getLoginIdentity(challenge.identityType, challenge.identityKey);
  if (!auth?.totpSecret || !auth.isMfaEnabled) return null;

  const result = await acceptVerifiedChallenge(
    async () => {
      const verification = await verifyTotpToken({
        token: code,
        secret: await decryptSecret(auth.totpSecret!),
        crypto: otpCrypto,
        base32,
        period: TOTP_PERIOD_SECONDS,
        epochTolerance: TOTP_PERIOD_SECONDS,
        afterTimeStep: auth.lastTotpTimeStep ?? undefined,
      });
      return verification.valid ? verification : null;
    },
    async () => Boolean(await consumeAuthChallengeByTokenHash(
      storedTokenHash,
      'totp',
      new Date().toISOString(),
    )),
  );
  if (!result) return null;

  await updateLoginIdentity(auth.type, auth.key, {
    lastTotpTimeStep: result.timeStep,
    updatedAt: new Date().toISOString(),
  });
  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
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
    organizationTitle: auth.organizationTitle,
    ...(await issueTokens(auth)),
  };
}
