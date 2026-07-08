import {
  consumeActiveAuthChallengesByUserAndKind,
  getAuthChallengeByTokenHash,
  insertAuthChallenge,
  updateAuthChallenge,
} from '@/lib/db/auth-challenges.node';
import { updateUser, type User } from '@/lib/db/users.node';
import { adoptExplorerFragments } from '@/lib/db/intelligence-fragments.node';
import { generateAlias, pickWelcomeLine } from '@/lib/alias';
import { randomToken, sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { approveHandoff, createHandoffSecret, HANDOFF_CLAIM_WINDOW_MS } from './auth-handoff';
import { sendBrandedEmail } from './email';
import { notifyCountersDirty } from './live-bus';
import { defaultNameFromEmail, normalizeEmail, upsertUserByEmail } from './users';
import { trackPlatformEvent } from '@/platform/events';

const WAITLIST_VERIFY_TTL_MS = 12 * 60 * 60 * 1000;

export function normalizeWaitlistEmail(email: string) {
  return normalizeEmail(email);
}

export function buildWaitlistVerifyLink(tokenHash: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const url = new URL('/public/waitlist/verify', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('flow', 'waitlist');
  return url.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function firstName(input: { email: string; name?: string | null }) {
  return escapeHtml(input.name?.trim() || defaultNameFromEmail(input.email) || 'there');
}

async function createWaitlistEmailChallenge(userId: string) {
  const now = new Date();
  const token = randomToken('vrtx_waitlist_');
  const publicTokenHash = await sha256(token);
  const storedTokenHash = await sha256(publicTokenHash);
  // The joining browser parks a handoff secret so verifying from any
  // other surface (a phone's mail view) still opens THIS browser's galaxy.
  const handoff = await createHandoffSecret();
  const expiresAt = new Date(Date.now() + WAITLIST_VERIFY_TTL_MS);

  await consumeActiveAuthChallengesByUserAndKind(userId, 'waitlist', now.toISOString());

  await insertAuthChallenge({
    key: newId(),
    identityKey: userId,
    identityType: 'user',
    kind: 'waitlist',
    tokenHash: storedTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
    handoffTokenHash: handoff.storedTokenHash,
  });

  return {
    tokenHash: publicTokenHash,
    expiresAt,
    handoffTokenHash: handoff.publicTokenHash,
    handoffExpiresAt: new Date(expiresAt.getTime() + HANDOFF_CLAIM_WINDOW_MS),
  };
}

export async function deliverWaitlistVerifyEmail(input: { email: string; name?: string | null; verifyLink: string; expiresAt: Date }) {
  const name = firstName(input);
  await sendBrandedEmail({
    from: process.env.ADMIN_EMAIL,
    to: input.email,
    subject: 'Verify your Vorinthex email',
    preheader: 'Confirm your email and open your public galaxy.',
    label: 'Waitlist',
    eyebrow: 'Confirm email',
    headline: 'Open your public galaxy',
    bodyHtml: [
      `<p style="margin:0 0 16px;">Hi ${name},</p>`,
      '<p style="margin:0 0 18px;">Confirm this email to secure your place on the Vorinthex waitlist.</p>',
      '<p style="margin:0;">Your public galaxy will open after verification.</p>',
    ].join(''),
    actionUrl: input.verifyLink,
    actionLabel: 'Verify email',
    supportingHtml: 'If you did not request this, you can ignore this email.',
    footerHtml: 'You received this because this email joined the Vorinthex waitlist.',
    extraPayload: {
      verification_link: input.verifyLink,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

export async function sendWaitlistVerificationEmailForUser(user: Pick<User, 'key' | 'email' | 'name'>) {
  const challenge = await createWaitlistEmailChallenge(user.key);
  const verifyLink = buildWaitlistVerifyLink(challenge.tokenHash);
  await deliverWaitlistVerifyEmail({
    email: user.email,
    name: user.name,
    verifyLink,
    expiresAt: challenge.expiresAt,
  });
  return {
    verifyLink,
    expiresAt: challenge.expiresAt,
    handoffTokenHash: challenge.handoffTokenHash,
    handoffExpiresAt: challenge.handoffExpiresAt,
  };
}

export async function requestWaitlistVerification(email: string, explorerId?: string, distinctId?: string, tempEmailHash?: string) {
  const normalized = normalizeWaitlistEmail(email);
  const entry = await upsertUserByEmail(normalized, {
    name: defaultNameFromEmail(normalized),
    is_subscribed_to_updates: true,
  }, { distinctId: distinctId ?? null });
  if (explorerId) {
    await adoptExplorerFragments(explorerId, entry.key);
  }
  trackPlatformEvent({
    slug: 'waitlist.signup_submitted',
    userId: entry.key,
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
      ...(tempEmailHash ? { temp_email_hash: tempEmailHash } : {}),
      is_verified: entry.isVerified,
    },
  });
  notifyCountersDirty();

  const alias = entry.alias ?? generateAlias(entry.key);

  if (entry.isVerified) {
    return {
      email: entry.email,
      isVerified: true as const,
      alias,
      aliasSlug: entry.alias_slug,
      waitlistNumber: entry.waitlistNumber,
    };
  }

  const delivery = await sendWaitlistVerificationEmailForUser(entry);

  return {
    email: entry.email,
    isVerified: false as const,
    alias,
    aliasSlug: entry.alias_slug,
    waitlistNumber: entry.waitlistNumber,
    verificationEmailSent: true,
    expiresAt: delivery.expiresAt,
    handoffTokenHash: delivery.handoffTokenHash,
    handoffExpiresAt: delivery.handoffExpiresAt,
    devVerifyLink: process.env.NODE_ENV === 'production' ? undefined : delivery.verifyLink,
  };
}

export async function verifyWaitlistEmail(tokenHash: string, explorerId?: string) {
  const storedTokenHash = await sha256(tokenHash);
  const now = new Date();

  const challenge = await getAuthChallengeByTokenHash(storedTokenHash);
  if (
    !challenge ||
    challenge.kind !== 'waitlist' ||
    challenge.consumedAt !== null ||
    new Date(challenge.expiresAt).getTime() <= now.getTime()
  ) {
    return null;
  }
  await updateAuthChallenge(challenge.key, { consumedAt: now.toISOString() });

  if (challenge.identityType !== 'user') return null;

  // Verifying from any surface wakes the browser that joined the waitlist.
  await approveHandoff({ key: challenge.key, handoffTokenHash: challenge.handoffTokenHash });

  const entry = await updateUser(challenge.identityKey, { isVerified: true, updatedAt: now.toISOString() });
  // Fragments collected anonymously since joining merge into the account
  // the moment email ownership is proven, not just at the initial join.
  if (explorerId) {
    const adopted = await adoptExplorerFragments(explorerId, entry.key);
    if (adopted > 0) notifyCountersDirty();
  }
  trackPlatformEvent({
    slug: 'waitlist.email_verified',
    userId: entry.key,
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
    },
  });
  notifyCountersDirty();

  const alias = entry.alias ?? generateAlias(entry.key);
  return {
    id: entry.key,
    email: entry.email,
    isVerified: entry.isVerified,
    alias,
    aliasSlug: entry.alias_slug,
    waitlistNumber: entry.waitlistNumber,
    welcomeLine: pickWelcomeLine(entry.key, alias),
  };
}
