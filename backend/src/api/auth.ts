import {
  consumeActiveAuthChallengesByIdentityAndKind,
  consumeAuthChallengeByTokenHash,
  consumeFounderRecoveryAndStartSetup,
  consumeSetupAuthorizationAndStartSetup,
  consumeTotpChallengeAndAdvanceMembership,
  deleteAuthChallenge,
  exchangeFounderTotpForRecovery,
  getAuthChallengeByTokenHash,
  insertAuthChallenge,
  type AuthChallenge,
  type authChallengeKindSchema,
  type authIdentityTypeSchema,
} from '@/lib/db/auth-challenges.node';
import { decryptSecret, encryptSecret, randomToken, sha256, timingSafeEqual } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { verify as verifyTotpToken } from '@otplib/totp';
import { base32 } from '@otplib/plugin-base32-scure';
import { crypto as otpCrypto } from '@otplib/plugin-crypto-noble';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { sendBrandedEmail } from './email';
import { defaultNameFromEmail, hashUserEmail, normalizeEmail, upsertUserByEmail } from './users';
import { countryCodeSchema, getUserByEmailHash, getUserById, touchUserLastLogin, updateUser, type User } from '@/lib/db/users.node';
import { getAuthSessionById, getAuthSessionByRefreshTokenHash, getSelectedTeamMfaState, insertAuthSession, revokeAuthSession } from '@/lib/db/auth-sessions.node';
import { provisionPersonalAuthContext, selectPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getTeamById } from '@/lib/db/teams.node';
import {
  getUserTeamById,
  listActiveUserTeamsByUser,
  type UserTeam,
} from '@/lib/db/user-team.node';
import { generateAlias, pickWelcomeLine } from '@/lib/alias';
import { redisConnection } from '@/lib/redis';
import { approveHandoff, createHandoffSecret, HANDOFF_CLAIM_WINDOW_MS } from './auth-handoff';
import { rawReferralCodeSchema } from '@/lib/referrals/contracts';
import { normalizeReferralCode } from '@/lib/referrals/service';
import { completeReferralForNewlyVerifiedUser } from './auth-referrals';
import { recordAuthCompletion } from '@/lib/ai/events/auth-events';

const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;
const TOTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const FOUNDER_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOTP_PERIOD_SECONDS = 30;
const ISSUER = 'Vorinthex';
export const STANDARD_ACCESS_MAX_AGE_SECONDS = 60 * 15;
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
  sessionId?: string;
  founderAssured?: boolean;
  teamMembershipKey?: string;
  teamMfaVersion?: number;
}

interface LoginIdentity {
  type: LoginIdentityType;
  key: string;
  linkKey: string;
  teamKey: string;
  teamRole: UserTeam['teamRole'];
  email: string;
  emailHash: string;
  name: string | null;
  teamTitle: string | null;
  orchestratorKey: string | null;
  teamIsRoot: boolean;
  teamIsPersonal: boolean;
  teamMfaEnabled: boolean;
  isMfaEnabled: boolean;
  totpSecret: string | null;
  lastTotpTimeStep: number | null;
  teamMfaVersion: number;
  teamMfaRecoveryPending: boolean;
}

type ChallengeIdentityType = typeof authIdentityTypeSchema._type;
type ChallengeKind = typeof authChallengeKindSchema._type;

export type TotpChallengeValidationResult =
  | { status: 'totp_setup_required'; totpChallengeToken: string; expiresAt: Date }
  | { status: 'totp_required'; totpChallengeToken: string; expiresAt: Date };

export type MagicLinkValidationResult =
  | TotpChallengeValidationResult
  | { status: 'mfa_recovery_required'; totpChallengeToken: string; expiresAt: Date }
  | {
    status: 'totp_setup';
    setupChallengeToken: string;
    expiresAt: Date;
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }
  | ({
    status: 'authenticated';
    identity: AuthIdentity;
    alias: string;
    aliasSlug: string | null;
    welcomeLine: string;
  } & SessionTokens);

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
  return sha256(`${payload}.${requiredEnv('ACCESS_TOKEN_SECRET')}`);
}

const signedOAuthStateSchema = z.object({
  provider: z.enum(['google', 'apple']),
  redirectUri: z.string().url(),
  mobileRedirectUri: z.string().url().optional(),
  referralCode: rawReferralCodeSchema.nullable().default(null),
  nonce: z.string().min(1),
  exp: z.number(),
}).strict();

async function createSignedOAuthState(provider: OAuthProvider, redirectUri: string, mobileRedirectUri?: string, referralCode?: string) {
  const payload = jsonBase64Url({
    provider,
    redirectUri,
    mobileRedirectUri,
    referralCode: referralCode ?? null,
    nonce: randomToken('oauth_'),
    exp: Date.now() + 10 * 60 * 1000,
  });
  return `${payload}.${await signAccessTokenPayload(payload)}`;
}

async function verifySignedOAuthState(provider: OAuthProvider, state: string, redirectUri: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  const expected = await signAccessTokenPayload(payload);
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const parsed = signedOAuthStateSchema.parse(JSON.parse(base64UrlDecode(payload)));
    return parsed.provider === provider && parsed.redirectUri === redirectUri && parsed.exp > Date.now()
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function membershipIdentity(
  user: User,
  membership: UserTeam,
): Promise<LoginIdentity | null> {
  const team = await getTeamById(membership.teamKey);
  if (!team?.isActive) return null;
  return {
    type: loginIdentityTypeForMembership(membership.teamRole, team.is_root),
    key: user.key,
    linkKey: membership.key,
    teamKey: membership.teamKey,
    teamRole: membership.teamRole,
    email: user.email,
    emailHash: user.emailHash,
    name: user.name,
    teamTitle: membership.teamTitle,
    orchestratorKey: membership.orchestratorKey,
    teamIsRoot: team.is_root,
    teamIsPersonal: team.slug === `personal-${user.key}`,
    teamMfaEnabled: team.mfa_enabled,
    isMfaEnabled: membership.isMfaEnabled,
    totpSecret: membership.totpSecret,
    lastTotpTimeStep: membership.lastTotpTimeStep,
    teamMfaVersion: membership.teamMfaVersion,
    teamMfaRecoveryPending: membership.teamMfaRecoveryPending,
  };
}

export function loginIdentityTypeForMembership(teamRole: UserTeam['teamRole'], teamIsRoot: boolean): LoginIdentityType {
  return teamRole === 'owner' && teamIsRoot ? 'superAdmin' : 'member';
}

const membershipRoleRank: Record<UserTeam['teamRole'], number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 2,
  viewer: 1,
};

function strongestIdentity(identities: LoginIdentity[]): LoginIdentity | null {
  return identities.reduce<LoginIdentity | null>((best, identity) => {
    if (!best || membershipRoleRank[identity.teamRole] > membershipRoleRank[best.teamRole]) return identity;
    return best;
  }, null);
}

async function teamMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const memberships = await listActiveUserTeamsByUser(user.key);
  const identities = (await Promise.all(memberships.map((membership) => membershipIdentity(user, membership))))
    .filter((identity): identity is LoginIdentity => identity !== null);
  // MFA-enforcing memberships always win over ordinary personal ownership.
  const root = identities.find((identity) => identity.teamIsRoot && identity.teamMfaEnabled);
  if (root) return root;
  const enforced = identities.find((identity) => identity.teamMfaEnabled);
  if (enforced) return enforced;
  // A real team membership takes precedence over the automatically
  // provisioned personal workspace, even when personal ownership ranks higher.
  return strongestIdentity(identities.filter((identity) => !identity.teamIsPersonal))
    ?? strongestIdentity(identities);
}

async function rootTeamMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const memberships = await listActiveUserTeamsByUser(user.key);
  for (const membership of memberships) {
    const identity = await membershipIdentity(user, membership);
    if (identity?.teamIsRoot) return identity;
  }
  return null;
}

/**
 * Whether ANY of the user's active memberships belongs to a team
 * that enforces MFA. `team.mfa_enabled` is the single source of
 * truth for that decision — `is_root` only routes WHICH sign-in front door
 * is used (founders gate vs the regular TOTP flow), never whether MFA is
 * required. Prefers a root membership so founders always land on their
 * gate.
 */
async function mfaEnforcedMembershipIdentity(user: User): Promise<LoginIdentity | null> {
  const memberships = await listActiveUserTeamsByUser(user.key);
  let enforced: LoginIdentity | null = null;
  for (const membership of memberships) {
    const identity = await membershipIdentity(user, membership);
    if (!identity?.teamMfaEnabled) continue;
    if (identity.teamIsRoot) return identity;
    enforced ??= identity;
  }
  return enforced;
}

export async function findLoginIdentityByEmail(email: string): Promise<LoginIdentity | null> {
  const normalized = normalizeEmail(email);
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  if (!user) return null;
  return teamMembershipIdentity(user);
}

async function getLoginIdentityByMembership(
  identityType: LoginIdentityType,
  identityKey: string,
  teamMembershipKey: string,
): Promise<LoginIdentity | null> {
  const [user, membership] = await Promise.all([
    getUserById(identityKey),
    getUserTeamById(teamMembershipKey),
  ]);
  if (!user || !membership || membership.userId !== user.key || membership.status !== 'active') return null;
  const identity = await membershipIdentity(user, membership);
  return identity?.type === identityType ? identity : null;
}

async function getChallengeLoginIdentity(challenge: Pick<AuthChallenge, 'identityKey' | 'identityType' | 'teamMembershipKey'>) {
  if (challenge.identityType === 'user' || !challenge.teamMembershipKey) return null;
  return getLoginIdentityByMembership(challenge.identityType, challenge.identityKey, challenge.teamMembershipKey);
}

export function getAuthSessionPolicy(identityType: AuthIdentityType, founderAssured = false) {
  return identityType === 'superAdmin' || founderAssured
    ? { accessMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS }
    : { accessMaxAgeSeconds: STANDARD_ACCESS_MAX_AGE_SECONDS, refreshMaxAgeSeconds: STANDARD_REFRESH_MAX_AGE_SECONDS };
}

export function teamAssurance(identity: AuthIdentity | null | undefined) {
  const teamMembershipKey = identity?.teamMembershipKey;
  const teamMfaVersion = identity?.teamMfaVersion;
  return teamMembershipKey && typeof teamMfaVersion === 'number' ? { teamMembershipKey, teamMfaVersion } : undefined;
}

export function authenticatedTeamContext(identity: AuthIdentity) {
  const assurance = teamAssurance(identity);
  return { authenticatedUserKey: identity.key, ...(assurance ? { teamAssurance: assurance } : {}) };
}

export function resolveRefreshedIdentityType(
  storedIdentityType: AuthIdentityType | undefined,
  membershipIdentityType: LoginIdentityType | undefined,
  durableSession: boolean,
  mfaAssured: boolean,
): AuthIdentityType {
  if (storedIdentityType) return storedIdentityType;
  if (durableSession && !mfaAssured) return 'user';
  return membershipIdentityType ?? 'user';
}

export async function createAccessToken(identity: AuthIdentity | string, sessionExpiresAt?: Date) {
  const normalized = typeof identity === 'string'
    ? { key: identity, identityType: 'user' as const, founderAssured: false }
    : identity;
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getAuthSessionPolicy(normalized.identityType, normalized.founderAssured).accessMaxAgeSeconds;
  const sessionExpiry = sessionExpiresAt ? Math.floor(sessionExpiresAt.getTime() / 1000) : now + ttlSeconds;
  const payload = base64UrlEncode(JSON.stringify({
    sub: normalized.key,
    sid: normalized.sessionId,
    identityType: normalized.identityType,
    founder: normalized.founderAssured === true,
    teamMembershipKey: normalized.teamMembershipKey,
    teamMfaVersion: normalized.teamMfaVersion,
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
    const parsed = JSON.parse(base64UrlDecode(payload)) as {
      sub?: string;
      sid?: string;
      identityType?: AuthIdentityType;
      founder?: boolean;
      teamMembershipKey?: string;
      teamMfaVersion?: number;
      exp?: number;
    };
    if (typeof parsed.sub !== 'string' || !parsed.sub.trim() || typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    if (parsed.sid !== undefined && (typeof parsed.sid !== 'string' || !parsed.sid.trim())) return null;
    if (parsed.identityType !== undefined && !['user', 'member', 'superAdmin'].includes(parsed.identityType)) return null;
    if (parsed.teamMembershipKey !== undefined && typeof parsed.teamMembershipKey !== 'string') return null;
    if (parsed.teamMfaVersion !== undefined && typeof parsed.teamMfaVersion !== 'number') return null;
    if (parsed.sid) {
      const session = await getAuthSessionById(parsed.sid);
      if (!session || session.userId !== parsed.sub || session.revokedAt || !isRefreshTokenActive(session.expiresAt)) return null;
      const selected = await getSelectedTeamMfaState(parsed.sub);
      if (selected?.mfaEnabled && (
        !selected.membershipMfaEnabled
        || parsed.teamMembershipKey !== selected.teamMembershipKey
        || parsed.teamMfaVersion !== selected.teamMfaVersion
      )) return null;
    }
    return {
      key: parsed.sub,
      identityType: parsed.identityType ?? 'user',
      ...(parsed.sid ? { sessionId: parsed.sid } : {}),
      founderAssured: parsed.founder === true,
      ...(parsed.teamMembershipKey ? { teamMembershipKey: parsed.teamMembershipKey } : {}),
      ...(typeof parsed.teamMfaVersion === 'number' ? { teamMfaVersion: parsed.teamMfaVersion } : {}),
    };
  } catch {
    return null;
  }
}

export async function issueTokens(identity: LoginIdentity, sessionExpiresAt?: Date, founderAssured = false, mfaAssured = founderAssured): Promise<SessionTokens> {
  const sessionIdentityType: AuthIdentityType = founderAssured ? identity.type : 'user';
  const policy = getAuthSessionPolicy(sessionIdentityType, founderAssured);
  const issuedAt = Date.now();
  sessionExpiresAt ??= new Date(issuedAt + policy.refreshMaxAgeSeconds * 1000);
  const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt) / 1000));
  const sessionId = newId();
  const accessToken = await createAccessToken({
    key: identity.key,
    identityType: sessionIdentityType,
    sessionId,
    founderAssured,
    ...(mfaAssured ? {
      teamMembershipKey: identity.linkKey,
      teamMfaVersion: identity.teamMfaVersion,
    } : {}),
  }, sessionExpiresAt);
  const refreshToken = randomToken(founderAssured ? 'vrtx_refresh_founder_' : 'vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  const now = new Date().toISOString();
  await insertAuthSession({
    key: sessionId,
    userId: identity.key,
    identityType: sessionIdentityType,
    refreshTokenHash,
    expiresAt: sessionExpiresAt.toISOString(),
    revokedAt: null,
    teamMembershipKey: mfaAssured ? identity.linkKey : null,
    teamMfaVersion: mfaAssured ? identity.teamMfaVersion : null,
    createdAt: now,
    updatedAt: now,
  });
  await touchUserLastLogin(identity.key, now);
  return { accessToken, refreshToken, accessTokenMaxAgeSeconds: Math.min(policy.accessMaxAgeSeconds, remainingSeconds), refreshTokenMaxAgeSeconds: remainingSeconds, sessionExpiresAt: sessionExpiresAt.toISOString() };
}

export async function issueUserTokens(user: Pick<User, 'key'>, sessionExpiresAt?: Date): Promise<SessionTokens> {
  const policy = getAuthSessionPolicy('user');
  const issuedAt = Date.now();
  sessionExpiresAt ??= new Date(issuedAt + policy.refreshMaxAgeSeconds * 1000);
  const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt) / 1000));
  const sessionId = newId();
  const accessToken = await createAccessToken({ key: user.key, identityType: 'user', sessionId }, sessionExpiresAt);
  const refreshToken = randomToken('vrtx_refresh_');
  const refreshTokenHash = await sha256(refreshToken);
  const now = new Date().toISOString();
  await insertAuthSession({
    key: sessionId,
    userId: user.key,
    identityType: 'user',
    refreshTokenHash,
    expiresAt: sessionExpiresAt.toISOString(),
    revokedAt: null,
    teamMembershipKey: null,
    teamMfaVersion: null,
    createdAt: now,
    updatedAt: now,
  });
  await touchUserLastLogin(user.key, now);
  return { accessToken, refreshToken, accessTokenMaxAgeSeconds: Math.min(policy.accessMaxAgeSeconds, remainingSeconds), refreshTokenMaxAgeSeconds: remainingSeconds, sessionExpiresAt: sessionExpiresAt.toISOString() };
}

/**
 * Refresh an expired access token without rotating the refresh token. The
 * middleware can see several requests concurrently at the access-token
 * boundary; rotating here would make every request after the first one race
 * with a now-invalid cookie and turn a healthy session into a logout.
 */
export async function refreshAccessToken(refreshToken: string): Promise<SessionTokens | null> {
  const tokenHash = await sha256(refreshToken);
  const session = await getAuthSessionByRefreshTokenHash(tokenHash);
  if (!session || session.revokedAt || !isRefreshTokenActive(session.expiresAt)) return null;
  const user = await getUserById(session.userId);
  if (!user) return null;
  const expiresAt = session.expiresAt;
  const mfaTeamMembershipKey = session.teamMembershipKey;
  const teamMfaVersion = session.teamMfaVersion;
  const mfaAssured = Boolean(mfaTeamMembershipKey) && typeof teamMfaVersion === 'number';
  const storedIdentityType = session?.identityType;
  const needsMembership = storedIdentityType === 'member' || storedIdentityType === 'superAdmin';
  const identity = mfaAssured
    ? await getLoginIdentityByMembership('superAdmin', user.key, mfaTeamMembershipKey!)
      ?? await getLoginIdentityByMembership('member', user.key, mfaTeamMembershipKey!)
    : needsMembership
      ? await teamMembershipIdentity(user)
      : null;
  if (needsMembership && !identity) return null;
  if (storedIdentityType === 'superAdmin' && identity?.type !== 'superAdmin') return null;
  if (identity?.teamMfaEnabled && (
    !mfaAssured ||
    !identity.isMfaEnabled ||
    identity.linkKey !== mfaTeamMembershipKey ||
    identity.teamMfaVersion !== teamMfaVersion
  )) return null;
  const founderAssured = refreshToken.startsWith('vrtx_refresh_founder_') && identity?.teamIsRoot === true && mfaAssured;
  const identityType = resolveRefreshedIdentityType(storedIdentityType, identity?.type, true, mfaAssured);
  const policy = getAuthSessionPolicy(identityType, founderAssured);
  const sessionExpiresAt = new Date(Math.min(
    Date.parse(expiresAt!),
    Date.now() + policy.refreshMaxAgeSeconds * 1000,
  ));
  const issuedAt = Date.now();
  const remainingSeconds = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt) / 1000));
  const accessToken = await createAccessToken(
    {
      key: identity?.key ?? user.key,
      identityType,
      sessionId: session.key,
      founderAssured,
      ...(mfaAssured && identity ? {
        teamMembershipKey: identity.linkKey,
        teamMfaVersion: identity.teamMfaVersion,
      } : {}),
    },
    sessionExpiresAt,
  );
  return {
    accessToken,
    refreshToken,
    accessTokenMaxAgeSeconds: Math.min(policy.accessMaxAgeSeconds, remainingSeconds),
    refreshTokenMaxAgeSeconds: remainingSeconds,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
  };
}

export async function refreshTokenMatchesIdentity(refreshToken: string, identity: AuthIdentity): Promise<boolean> {
  const tokenHash = await sha256(refreshToken);
  const session = await getAuthSessionByRefreshTokenHash(tokenHash);
  return Boolean(session)
    && session!.key === identity.sessionId
    && session!.userId === identity.key
    && !session!.revokedAt
    && isRefreshTokenActive(session!.expiresAt);
}

export async function revokeSession(identity: AuthIdentity, refreshToken?: string | null): Promise<boolean> {
  if (identity.sessionId) return revokeAuthSession(identity.sessionId, identity.key, new Date().toISOString());
  if (!refreshToken) return false;
  const session = await getAuthSessionByRefreshTokenHash(await sha256(refreshToken));
  const revokedAt = new Date().toISOString();
  if (!session || session.userId !== identity.key) return false;
  return revokeAuthSession(session.key, identity.key, revokedAt);
}

export async function revokeRefreshSession(refreshToken: string): Promise<boolean> {
  const tokenHash = await sha256(refreshToken);
  const session = await getAuthSessionByRefreshTokenHash(tokenHash);
  const revokedAt = new Date().toISOString();
  return session ? revokeAuthSession(session.key, session.userId, revokedAt) : false;
}

export function isRefreshTokenActive(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

export async function createChallengeTokenHash(rawToken: string) {
  return sha256(rawToken);
}

export function isChallengeUsableForPurpose<T extends Pick<AuthChallenge, 'kind' | 'consumedAt' | 'expiresAt'>>(
  challenge: T | null,
  purposes: readonly ChallengeKind[],
  now = Date.now(),
): challenge is T {
  return Boolean(
    challenge &&
    purposes.includes(challenge.kind) &&
    challenge.consumedAt === null &&
    new Date(challenge.expiresAt).getTime() > now,
  );
}

const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
const MFA_CHALLENGE_ATTEMPT_WINDOW_SECONDS = 10 * 60;

async function mfaChallengeThrottled(storedTokenHash: string) {
  try {
    return Number(await redisConnection.get(`auth:mfa-attempts:${storedTokenHash}`) ?? 0) >= MFA_CHALLENGE_MAX_ATTEMPTS;
  } catch {
    return false;
  }
}

async function recordFailedMfaChallengeAttempt(storedTokenHash: string) {
  try {
    const key = `auth:mfa-attempts:${storedTokenHash}`;
    const count = await redisConnection.incr(key);
    if (count === 1) await redisConnection.expire(key, MFA_CHALLENGE_ATTEMPT_WINDOW_SECONDS);
  } catch {
    // The public auth IP limiter remains fail-closed when Redis is unavailable.
  }
}

export async function createChallenge(
  identityKey: string,
  kind: ChallengeKind,
  ttlMs: number,
  identityType: ChallengeIdentityType = 'user',
  options: { withHandoff?: boolean; teamMembershipKey?: string; scopeKey?: string; referralCode?: string } = {},
) {
  const prepared = await prepareChallenge(identityKey, kind, ttlMs, identityType, options);
  await insertAuthChallenge(prepared.document);
  return prepared.result;
}

export async function prepareChallenge(
  identityKey: string,
  kind: ChallengeKind,
  ttlMs: number,
  identityType: ChallengeIdentityType,
  options: { withHandoff?: boolean; teamMembershipKey?: string; scopeKey?: string; referralCode?: string } = {},
) {
  const token = randomToken(`vrtx_${kind}_`);
  const publicTokenHash = await createChallengeTokenHash(token);
  const storedTokenHash = await sha256(publicTokenHash);
  // The requesting browser's cross-device secret: parked on the same doc,
  // approved when the link is tapped, claimed once by the origin browser.
  const handoff = options.withHandoff ? await createHandoffSecret() : null;
  const expiresAt = new Date(Date.now() + ttlMs);
  const document = {
    key: newId(),
    identityKey,
    identityType,
    teamMembershipKey: options.teamMembershipKey ?? null,
    scopeKey: options.scopeKey ?? null,
    referralCode: options.referralCode ?? null,
    kind,
    tokenHash: storedTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    ...(handoff ? { handoffTokenHash: handoff.storedTokenHash } : {}),
  };
  return {
    document,
    result: {
      tokenHash: publicTokenHash,
      expiresAt,
      handoffTokenHash: handoff?.publicTokenHash ?? null,
    },
  };
}

export async function createTotpChallengeForIdentity(
  identityType: LoginIdentityType,
  identityKey: string,
  teamMembershipKey: string,
  kind: 'totp' | 'founder_totp' | 'founder_setup' = 'totp',
  scopeKey?: string,
): Promise<TotpChallengeValidationResult | null> {
  const auth = await getLoginIdentityByMembership(identityType, identityKey, teamMembershipKey);
  if (!auth?.teamMfaEnabled) return null;

  const founderChallenge = kind !== 'totp';
  if (founderChallenge) {
    const invalidatedAt = new Date().toISOString();
    await Promise.all([
      consumeActiveAuthChallengesByIdentityAndKind(auth.key, auth.type, 'founder_totp', invalidatedAt),
      consumeActiveAuthChallengesByIdentityAndKind(auth.key, auth.type, 'founder_setup', invalidatedAt),
    ]);
  }
  const totpChallenge = await createChallenge(
    auth.key,
    kind,
    founderChallenge ? FOUNDER_CHALLENGE_TTL_MS : TOTP_CHALLENGE_TTL_MS,
    auth.type,
    { teamMembershipKey: auth.linkKey, scopeKey },
  );
  return {
    status: auth.isMfaEnabled ? 'totp_required' : 'totp_setup_required',
    totpChallengeToken: totpChallenge.tokenHash,
    expiresAt: totpChallenge.expiresAt,
  };
}

export async function consumeChallenge(tokenHash: string, kind: ChallengeKind) {
  const storedTokenHash = await sha256(tokenHash);
  const now = new Date();
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (!isChallengeUsableForPurpose(challenge, [kind], now.getTime())) return null;
  const updated = await consumeAuthChallengeByTokenHash(storedTokenHash, kind, now.toISOString());
  if (!updated) return null;
  return {
    id: updated.key,
    identityKey: updated.identityKey,
    identityType: updated.identityType,
    teamMembershipKey: updated.teamMembershipKey,
    referralCode: updated.referralCode,
    kind: updated.kind,
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

export async function buildOAuthAuthorizationUrl(provider: OAuthProvider, redirectUri: string, mobileRedirectUri?: string, referralCode?: string) {
  const state = await createSignedOAuthState(provider, redirectUri, mobileRedirectUri, referralCode);
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
  url.searchParams.set('response_mode', mobileRedirectUri ? 'form_post' : 'query');
  url.searchParams.set('state', state);
  return url.toString();
}

function formBody(input: Record<string, string>) {
  return new URLSearchParams(input).toString();
}

function decodeJwtPart(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(base64UrlDecode(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type AppleJwk = JsonWebKey & { kid?: string; alg?: string };

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

export async function verifyAppleIdentityToken(
  token: string,
  loadKeys: () => Promise<AppleJwk[]> = async () => {
    const response = await fetch('https://appleid.apple.com/auth/keys');
    const body = await response.json().catch(() => null) as { keys?: AppleJwk[] } | null;
    if (!response.ok || !Array.isArray(body?.keys)) throw new Error('Apple signing keys unavailable');
    return body.keys;
  },
  options: { clientId?: string; nonce?: string } = {},
) {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !payload) return null;
  const key = (await loadKeys()).find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === 'RS256'));
  if (!key) return null;
  const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    Buffer.from(encodedSignature, 'base64url'),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  const audience = payload.aud;
  const expectedAudience = options.clientId ?? requiredEnv('APPLE_OAUTH_CLIENT_ID');
  const audienceMatches = audience === expectedAudience || (Array.isArray(audience) && audience.includes(expectedAudience));
  const now = Math.floor(Date.now() / 1000);
  const nonceMatches = !options.nonce || payload.nonce === await sha256(options.nonce);
  if (!validSignature || payload.iss !== 'https://appleid.apple.com' || !audienceMatches || !nonceMatches
    || typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number' || payload.exp <= now) return null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  if (!email || (payload.email_verified !== true && payload.email_verified !== 'true')) return null;
  return { email, name: null, profileUrl: null };
}

export async function verifyGoogleIdentityToken(
  token: string,
  loadKeys: () => Promise<GoogleJwk[]> = async () => {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const body = await response.json().catch(() => null) as { keys?: GoogleJwk[] } | null;
    if (!response.ok || !Array.isArray(body?.keys)) throw new Error('Google signing keys unavailable');
    return body.keys;
  },
) {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !payload) return null;
  try {
    const key = (await loadKeys()).find((candidate) => candidate.kid === header.kid
      && (!candidate.alg || candidate.alg === 'RS256')
      && (!candidate.use || candidate.use === 'sig'));
    if (!key) return null;
    const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const validSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(encodedSignature, 'base64url'),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    const audience = payload.aud;
    const expectedAudience = requiredEnv('GOOGLE_OAUTH_CLIENT_ID');
    const audienceMatches = audience === expectedAudience || (Array.isArray(audience) && audience.includes(expectedAudience));
    const now = Math.floor(Date.now() / 1000);
    const issuerMatches = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!validSignature || !issuerMatches || !audienceMatches || typeof payload.exp !== 'number' || payload.exp <= now
      || typeof payload.sub !== 'string' || !payload.sub || !email
      || (payload.email_verified !== true && payload.email_verified !== 'true')) return null;
    return {
      email,
      name: typeof payload.name === 'string' ? payload.name : null,
      profileUrl: null,
    };
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
    iss: requiredEnv('APPLE_OAUTH_TEAM_KEY'),
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
  if (!profileResponse.ok || !profile?.email || profile.email_verified !== true) return null;
  return { email: profile.email, name: profile.name ?? null, profileUrl: null };
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
  return verifyAppleIdentityToken(tokenData.id_token);
}

async function completeOAuthProfile(
  profile: { email: string; name: string | null; profileUrl: string | null },
  provider: OAuthProvider,
  mobileRedirectUri?: string,
  referralCode?: string | null,
) {
  const normalized = normalizeEmail(profile.email);

  const existingUser = await getUserByEmailHash(await hashUserEmail(normalized));
  const user = await upsertUserByEmail(normalized, {
    ...(profile.name ? { name: profile.name } : {}),
    isVerified: true,
    lastLoginAt: new Date().toISOString(),
    ...(!(existingUser?.isVerified ?? false) && referralCode ? { pendingReferralCode: normalizeReferralCode(referralCode) } : {}),
  }, { initializeNameOnly: true });
  await provisionPersonalAuthContext(user);
  const personalContext = await selectPersonalAuthContext(user.key);
  const tokens = await issueUserTokens(user);
  await completeReferralForNewlyVerifiedUser({ userKey: user.key, wasVerified: existingUser?.isVerified ?? false, referralCode });
  await recordAuthCompletion({
    method: provider,
    userKey: user.key,
    scopeKey: personalContext?.scope.key ?? user.currentScopeKey,
    wasVerified: existingUser?.isVerified ?? false,
  });
  const alias = user.alias ?? generateAlias(user.key);
  return {
    status: 'authenticated' as const,
    identity: { key: user.key, identityType: 'user' as const },
    ...tokens,
    alias,
    aliasSlug: user.alias_slug,
    welcomeLine: pickWelcomeLine(user.key, alias),
    mobileRedirectUri,
  };
}

export async function completeOAuthSignIn(input: {
  provider: OAuthProvider;
  code: string;
  state: string;
  redirectUri: string;
}) {
  const state = await verifySignedOAuthState(input.provider, input.state, input.redirectUri);
  if (!state) return null;
  const profile = input.provider === 'google'
    ? await exchangeGoogleCode(input.code, input.redirectUri)
    : await exchangeAppleCode(input.code, input.redirectUri);
  return profile ? completeOAuthProfile(profile, input.provider, state.mobileRedirectUri, state.referralCode) : null;
}

export async function completeNativeGoogleSignIn(idToken: string, referralCode?: string) {
  const profile = await verifyGoogleIdentityToken(idToken);
  return profile ? completeOAuthProfile(profile, 'google', undefined, referralCode) : null;
}

export async function completeNativeAppleSignIn(idToken: string, nonce: string, name?: string, referralCode?: string) {
  const profile = await verifyAppleIdentityToken(idToken, undefined, {
    clientId: requiredEnv('APPLE_NATIVE_CLIENT_ID'),
    nonce,
  });
  return profile ? completeOAuthProfile({ ...profile, name: name?.trim() || profile.name }, 'apple', undefined, referralCode) : null;
}

function allowedMobileOAuthRedirect(uri: string) {
  const allowed = [
    'vorinthexcore://auth/oauth-complete',
    ...(process.env.MOBILE_OAUTH_REDIRECT_URIS ?? '').split(','),
  ].map((value) => value.trim()).filter(Boolean);
  return allowed.includes(uri);
}

export function mobileOAuthCallbackUri(provider: OAuthProvider) {
  const origin = process.env.BACKEND_PUBLIC_URL ?? (process.env.NODE_ENV === 'production' ? 'https://vorinthex.com' : 'http://localhost:3001');
  return new URL(`/api/v1/auth/mobile/oauth/${provider}/callback`, origin).toString();
}

export async function buildMobileOAuthAuthorizationUrl(provider: OAuthProvider, mobileRedirectUri: string, referralCode?: string) {
  if (!allowedMobileOAuthRedirect(mobileRedirectUri)) throw new Error('mobile OAuth redirect is not allowed');
  const callbackUri = mobileOAuthCallbackUri(provider);
  return buildOAuthAuthorizationUrl(provider, callbackUri, mobileRedirectUri, referralCode);
}

const mobileGrantSchema = z.object({
  accessToken: z.string().startsWith('vrtx_access_'),
  refreshToken: z.string().startsWith('vrtx_refresh_'),
  accessTokenMaxAgeSeconds: z.number().int().nonnegative(),
  refreshTokenMaxAgeSeconds: z.number().int().nonnegative(),
  sessionExpiresAt: z.string().datetime(),
  alias: z.string(),
  aliasSlug: z.string().nullable(),
  welcomeLine: z.string(),
}).strict();

export async function createMobileOAuthGrant(result: z.infer<typeof mobileGrantSchema>) {
  const code = randomToken('vrtx_mobile_grant_');
  const key = `auth:mobile-grant:${await sha256(code)}`;
  const stored = await redisConnection.set(key, JSON.stringify(mobileGrantSchema.parse(result)), 'EX', 120, 'NX');
  if (stored !== 'OK') throw new Error('mobile OAuth grant unavailable');
  return code;
}

export async function exchangeMobileOAuthGrant(code: string) {
  const key = `auth:mobile-grant:${await sha256(code)}`;
  const value = await redisConnection.getdel(key);
  if (!value) return null;
  return mobileGrantSchema.parse(JSON.parse(value));
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
  const linkMinutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000));
  const mfaBody = input.mfaEnabled
    ? `<p style="margin:0;">Follow the link below to sign in with your MFA code. For your security, the link expires in ${linkMinutes} minutes.</p>`
    : `<p style="margin:0;">Follow the link below to set up multi-factor authentication and secure your platform access. For your security, the link expires in ${linkMinutes} minutes.</p>`;
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
    bodyHtml: `<p style="margin:0 0 16px;">Hi ${input.name},</p><p style="margin:0;">Follow the link below to set up a new authenticator. Access stays locked until setup is complete, and the link expires in 15 minutes.</p>`,
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

export async function requestSignInEmail(email: string, countryCode?: z.infer<typeof countryCodeSchema>, referralCode?: string) {
  const normalized = normalizeEmail(email);
  // Email possession establishes only base user authentication. Team
  // MFA is evaluated later against the explicitly selected membership.
  const existingUser = await getUserByEmailHash(await hashUserEmail(normalized));
  const user = existingUser ?? await upsertUserByEmail(normalized, {
    name: defaultNameFromEmail(normalized),
    profileUrl: null,
    ...(countryCode ? { countryCode } : {}),
    ...(referralCode ? { pendingReferralCode: normalizeReferralCode(referralCode) } : {}),
  });
  if (existingUser && !existingUser.isVerified && referralCode) await updateUser(existingUser.key, { pendingReferralCode: normalizeReferralCode(referralCode), updatedAt: new Date().toISOString() });

  const challenge = await createChallenge(user.key, 'email', EMAIL_LINK_TTL_MS, 'user', { withHandoff: true, referralCode });
  const magicLink = buildMagicLink(challenge.tokenHash, 'user');
  await deliverSignInEmail({ email: normalized, magicLink, expiresAt: challenge.expiresAt });
  return {
    allowed: true as const,
    expiresAt: challenge.expiresAt,
    handoffTokenHash: challenge.handoffTokenHash,
    // The origin browser may claim for the full link TTL plus the
    // approval window after a last-second tap.
    handoffExpiresAt: new Date(challenge.expiresAt.getTime() + HANDOFF_CLAIM_WINDOW_MS),
  };
}

export async function requestFoundersGate(email: string) {
  const startedAt = Date.now();
  const accepted = async (expiresAt: Date) => {
    const remaining = 200 - (Date.now() - startedAt);
    if (remaining > 0) await Bun.sleep(remaining);
    return { accepted: true as const, expiresAt };
  };
  const normalized = normalizeEmail(email);
  const user = await getUserByEmailHash(await hashUserEmail(normalized));
  const fallbackExpiresAt = new Date(Date.now() + FOUNDER_CHALLENGE_TTL_MS);
  if (!user) return accepted(fallbackExpiresAt);
  const identity = await rootTeamMembershipIdentity(user);
  if (!identity) return accepted(fallbackExpiresAt);

  try {
    const cooldownKey = `founder-auth:email:${await sha256(normalized)}`;
    const canSend = await redisConnection.set(cooldownKey, '1', 'EX', 60, 'NX');
    if (canSend !== 'OK') return accepted(fallbackExpiresAt);

    const now = new Date().toISOString();
    await consumeActiveAuthChallengesByIdentityAndKind(identity.key, identity.type, 'founder_email', now);
    const challenge = await createChallenge(
      identity.key,
      'founder_email',
      FOUNDER_CHALLENGE_TTL_MS,
      identity.type,
      { teamMembershipKey: identity.linkKey },
    );
    void deliverMemberSignInEmail({
      email: normalized,
      name: memberGreetingName(identity),
      magicLink: buildMfaLink(challenge.tokenHash),
      mfaEnabled: identity.isMfaEnabled,
      expiresAt: challenge.expiresAt,
    }).catch((error) => {
      console.error('founder sign-in email delivery failed', error instanceof Error ? error.message : String(error));
    });
    return accepted(fallbackExpiresAt);
  } catch (error) {
    console.error('founder sign-in request failed', error instanceof Error ? error.message : String(error));
    return accepted(fallbackExpiresAt);
  }
}

export async function requestMfaResetEmail(challengeToken: string) {
  const storedTokenHash = await sha256(challengeToken);
  const pending = await getAuthChallengeByTokenHash(storedTokenHash);
  if (!isChallengeUsableForPurpose(pending, ['totp', 'founder_totp']) || pending?.identityType === 'user') {
    return null;
  }
  const identity = await getChallengeLoginIdentity(pending);
  if (!identity?.teamMfaEnabled || (!identity.isMfaEnabled && !identity.teamMfaRecoveryPending)) return null;
  const recoveryKind = identity.teamIsRoot ? 'founder_recovery' : 'team_recovery';
  const recovery = await prepareChallenge(
    identity.key,
    recoveryKind,
    EMAIL_LINK_TTL_MS,
    identity.type,
    { teamMembershipKey: identity.linkKey, ...(pending.scopeKey ? { scopeKey: pending.scopeKey } : {}) },
  );
  await insertAuthChallenge(recovery.document);
  try {
    // The recovery token is durable before delivery, while the source remains
    // retryable until the provider accepts the email.
    await deliverMfaResetEmail({
      email: identity.email,
      name: memberGreetingName(identity),
      magicLink: buildMfaLink(recovery.result.tokenHash),
      expiresAt: recovery.result.expiresAt,
    });
  } catch (error) {
    await deleteAuthChallenge(recovery.document.key).catch(() => undefined);
    throw error;
  }
  const exchangedAt = new Date().toISOString();
  if (!await exchangeFounderTotpForRecovery({
    sourceTokenHash: storedTokenHash,
    identityKey: identity.key,
    identityType: identity.type,
    teamMembershipKey: identity.linkKey,
    exchangedAt,
    recoveryChallenge: recovery.document,
  })) {
    await deleteAuthChallenge(recovery.document.key).catch(() => undefined);
    return null;
  }
  return { ok: true as const, expiresAt: recovery.result.expiresAt };
}

export async function validateMagicLink(token: string): Promise<MagicLinkValidationResult | null> {
  const storedTokenHash = await sha256(token);
  const pending = await getAuthChallengeByTokenHash(storedTokenHash);
  if (pending?.kind === 'founder_recovery' || pending?.kind === 'team_recovery') return startTotpSetup(token);
  if (!pending || (pending.kind !== 'email' && pending.kind !== 'founder_email')) return null;
  const emailChallenge = await consumeChallenge(token, pending.kind);
  if (!emailChallenge) return null;

  if (emailChallenge.identityType === 'user') {
    const user = await getUserById(emailChallenge.identityKey);
    if (!user) return null;
    // Signing in proves inbox ownership — it verifies the email too.
    const verifiedUser = await updateUser(user.key, {
      isVerified: true,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await provisionPersonalAuthContext(verifiedUser);
    const personalContext = await selectPersonalAuthContext(verifiedUser.key);
    const tokens = await issueUserTokens(verifiedUser);
    await completeReferralForNewlyVerifiedUser({ userKey: verifiedUser.key, wasVerified: user.isVerified, referralCode: emailChallenge.referralCode });
    // Publish only after verification and session prerequisites are durable,
    // otherwise the waiting client can race ahead and burn its one-shot claim.
    try {
      await approveHandoff({ key: emailChallenge.id, handoffTokenHash: emailChallenge.handoffTokenHash });
    } catch (error) {
      // The tapping client already has a valid session. Handoff failure must
      // not turn that successful one-time link into an unrecoverable error.
      console.warn('magic-link handoff approval failed', error instanceof Error ? error.message : String(error));
    }
    await recordAuthCompletion({
      method: 'email',
      userKey: verifiedUser.key,
      scopeKey: personalContext?.scope.key ?? verifiedUser.currentScopeKey,
      wasVerified: user.isVerified,
    });
    const alias = verifiedUser.alias ?? generateAlias(verifiedUser.key);
    return {
      status: 'authenticated',
      identity: { key: verifiedUser.key, identityType: 'user' },
      ...tokens,
      alias,
      aliasSlug: verifiedUser.alias_slug,
      welcomeLine: pickWelcomeLine(verifiedUser.key, alias),
    };
  }

  const auth = await getChallengeLoginIdentity(emailChallenge);
  if (!auth) return null;
  if (emailChallenge.kind === 'founder_email') {
    if (!auth.teamIsRoot) return null;
    if (auth.teamMfaRecoveryPending) {
      const invalidatedAt = new Date().toISOString();
      await Promise.all([
        consumeActiveAuthChallengesByIdentityAndKind(auth.key, auth.type, 'founder_totp', invalidatedAt),
        consumeActiveAuthChallengesByIdentityAndKind(auth.key, auth.type, 'founder_setup', invalidatedAt),
      ]);
      const recoveryRequest = await createChallenge(
        auth.key,
        'founder_totp',
        FOUNDER_CHALLENGE_TTL_MS,
        auth.type,
        { teamMembershipKey: auth.linkKey },
      );
      return {
        status: 'mfa_recovery_required',
        totpChallengeToken: recoveryRequest.tokenHash,
        expiresAt: recoveryRequest.expiresAt,
      };
    }
    return createTotpChallengeForIdentity(
      auth.type,
      auth.key,
      auth.linkKey,
      auth.isMfaEnabled ? 'founder_totp' : 'founder_setup',
    );
  }
  await approveHandoff({ key: emailChallenge.id, handoffTokenHash: emailChallenge.handoffTokenHash });
  if (auth.teamMfaEnabled) {
    return createTotpChallengeForIdentity(emailChallenge.identityType, emailChallenge.identityKey, auth.linkKey);
  }
  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await provisionPersonalAuthContext({ key: auth.key, name: auth.name, email: auth.email });
  return {
    status: 'authenticated',
    identity: { key: auth.key, identityType: 'user' as const },
    ...(await issueTokens(auth)),
    alias: auth.name ?? defaultNameFromEmail(auth.email) ?? auth.email,
    aliasSlug: null,
    welcomeLine: `Welcome back${auth.name ? `, ${auth.name}` : ''}.`,
  };
}

export async function createUserWithAuth(input: { email: string; name?: string; country_code?: z.infer<typeof countryCodeSchema> }) {
  const normalized = normalizeEmail(input.email);
  const user = await upsertUserByEmail(normalized, {
    name: input.name ?? defaultNameFromEmail(normalized),
    profileUrl: null,
    ...(input.country_code ? { countryCode: input.country_code } : {}),
  });
  return { userId: user.key };
}

export async function startTotpSetup(challengeToken: string) {
  const storedTokenHash = await sha256(challengeToken);
  const pending = await getAuthChallengeByTokenHash(storedTokenHash);
  if (!isChallengeUsableForPurpose(pending, ['totp', 'founder_setup', 'founder_recovery', 'team_recovery'])) return null;
  if (pending.identityType === 'user') return null;
  const identity = await getChallengeLoginIdentity(pending);
  if (!identity?.teamMfaEnabled) return null;
  const isRecovery = pending.kind === 'founder_recovery' || pending.kind === 'team_recovery';
  if (isRecovery
    ? (!identity.isMfaEnabled && !identity.teamMfaRecoveryPending)
    : (identity.isMfaEnabled || identity.teamMfaRecoveryPending)) return null;
  if ((pending.kind === 'founder_setup' || pending.kind === 'founder_recovery') && !identity.teamIsRoot) return null;

  const secret = generateSecret();
  const encryptedSecret = await encryptSecret(secret);
  const otpauthUrl = generateURI({ issuer: ISSUER, label: identity.email, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1 });
  const setupKind = pending.kind === 'totp' || pending.kind === 'team_recovery' ? 'totp' : 'founder_setup';
  const setupChallenge = await prepareChallenge(
    identity.key,
    setupKind,
    setupKind === 'totp' ? TOTP_CHALLENGE_TTL_MS : FOUNDER_CHALLENGE_TTL_MS,
    identity.type,
    { teamMembershipKey: identity.linkKey, ...(pending.scopeKey ? { scopeKey: pending.scopeKey } : {}) },
  );

  if (isRecovery) {
    const startedAt = new Date().toISOString();
    if (!await consumeFounderRecoveryAndStartSetup({
      recoveryTokenHash: storedTokenHash,
      identityKey: identity.key,
      identityType: identity.type,
      teamMembershipKey: identity.linkKey,
      expectedMfaVersion: identity.teamMfaVersion,
      encryptedSecret,
      startedAt,
      setupChallenge: setupChallenge.document,
    })) return null;
    return {
      status: 'totp_setup' as const,
      setupChallengeToken: setupChallenge.result.tokenHash,
      expiresAt: setupChallenge.result.expiresAt,
      secret,
      otpauthUrl,
      qrCodeDataUrl,
    };
  }

  if (pending.kind !== 'totp' && pending.kind !== 'founder_setup') return null;
  const startedAt = new Date().toISOString();
  if (!await consumeSetupAuthorizationAndStartSetup({
    sourceTokenHash: storedTokenHash,
    sourceKind: pending.kind,
    identityKey: identity.key,
    identityType: identity.type,
    teamMembershipKey: identity.linkKey,
    encryptedSecret,
    startedAt,
    setupChallenge: setupChallenge.document,
  })) return null;
  return {
    status: 'totp_setup' as const,
    setupChallengeToken: setupChallenge.result.tokenHash,
    expiresAt: setupChallenge.result.expiresAt,
    secret,
    otpauthUrl,
    qrCodeDataUrl,
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
  const storedTokenHash = await sha256(challengeToken);
  if (await mfaChallengeThrottled(storedTokenHash)) return { ok: false as const, error: 'challenge throttled' };
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (!isChallengeUsableForPurpose(challenge, ['totp', 'founder_setup']) || challenge?.identityType === 'user') {
    return { ok: false as const, error: 'invalid challenge' };
  }
  const auth = await getChallengeLoginIdentity(challenge);
  if (!auth?.teamMfaEnabled || !auth.totpSecret) return { ok: false as const, error: 'setup unavailable' };
  if (auth.isMfaEnabled) {
    return { ok: false as const, error: 'setup unavailable' };
  }

  const lastTimeStep = await verifySuccessiveTotpCodes(await decryptSecret(auth.totpSecret), codes);
  if (!lastTimeStep) {
    await recordFailedMfaChallengeAttempt(storedTokenHash);
    return { ok: false as const, error: 'invalid totp codes' };
  }
  const completedAt = new Date().toISOString();
  if (!await consumeTotpChallengeAndAdvanceMembership({
    tokenHash: storedTokenHash,
    kind: challenge.kind,
    teamMembershipKey: auth.linkKey,
    timeStep: lastTimeStep,
    consumedAt: completedAt,
    completeSetup: true,
  })) {
    return { ok: false as const, error: 'invalid challenge' };
  }

  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await provisionPersonalAuthContext({ key: auth.key, name: auth.name, email: auth.email });
  return {
    ok: true as const,
    identity: { key: auth.key, identityType: challenge.kind === 'founder_setup' ? auth.type : 'user' as const },
    name: auth.name,
    teamTitle: auth.teamTitle,
    teamKey: auth.teamKey,
    scopeKey: challenge.scopeKey,
    ...(await issueTokens(auth, undefined, challenge.kind === 'founder_setup', true)),
  };
}

export async function verifyTotpAndIssueSession(challengeToken: string, code: string) {
  const storedTokenHash = await sha256(challengeToken);
  if (await mfaChallengeThrottled(storedTokenHash)) return null;
  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (!isChallengeUsableForPurpose(challenge, ['totp', 'founder_totp']) || challenge?.identityType === 'user') {
    return null;
  }
  const auth = await getChallengeLoginIdentity(challenge);
  if (!auth?.teamMfaEnabled || !auth.totpSecret || !auth.isMfaEnabled) return null;

  const result = await verifyTotpToken({
    token: code,
    secret: await decryptSecret(auth.totpSecret),
    crypto: otpCrypto,
    base32,
    period: TOTP_PERIOD_SECONDS,
    epochTolerance: TOTP_PERIOD_SECONDS,
    afterTimeStep: auth.lastTotpTimeStep ?? undefined,
  });
  if (!result.valid) {
    await recordFailedMfaChallengeAttempt(storedTokenHash);
    return null;
  }
  const verifiedAt = new Date().toISOString();
  if (!await consumeTotpChallengeAndAdvanceMembership({
    tokenHash: storedTokenHash,
    kind: challenge.kind,
    teamMembershipKey: auth.linkKey,
    timeStep: result.timeStep,
    consumedAt: verifiedAt,
  })) return null;

  await updateUser(auth.key, {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await provisionPersonalAuthContext({ key: auth.key, name: auth.name, email: auth.email });
  return {
    identity: { key: auth.key, identityType: challenge.kind === 'founder_totp' ? auth.type : 'user' as const },
    name: auth.name,
    teamTitle: auth.teamTitle,
    teamKey: auth.teamKey,
    scopeKey: challenge.scopeKey,
    ...(await issueTokens(auth, undefined, challenge.kind === 'founder_totp', true)),
  };
}
