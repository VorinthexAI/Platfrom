import { insertAuthChallenge, getAuthChallengeByTokenHash, updateAuthChallenge } from '@/lib/db/auth-challenges.node';
import { updateUser, type User } from '@/lib/db/users.node';
import { randomToken, sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { sendBrandedEmail } from './email';
import { defaultNameFromEmail, normalizeEmail, upsertUserByEmail } from './users';
import { trackPlatformEvent } from '@/platform/events';

const WAITLIST_VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

export function normalizeWaitlistEmail(email: string) {
  return normalizeEmail(email);
}

export function buildWaitlistVerifyLink(tokenHash: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const url = new URL('/public/waitlist/verify', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
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
  const token = randomToken('vrtx_waitlist_');
  const publicTokenHash = await sha256(token);
  const storedTokenHash = await sha256(publicTokenHash);
  const expiresAt = new Date(Date.now() + WAITLIST_VERIFY_TTL_MS);

  await insertAuthChallenge({
    key: newId(),
    userId,
    kind: 'waitlist',
    tokenHash: storedTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });

  return { tokenHash: publicTokenHash, expiresAt };
}

export async function deliverWaitlistVerifyEmail(input: { email: string; name?: string | null; verifyLink: string; expiresAt: Date }) {
  const name = firstName(input);
  await sendBrandedEmail({
    from: process.env.ADMIN_EMAIL,
    to: input.email,
    subject: 'Welcome to Vorinthex',
    preheader: 'You are on the waitlist. Confirm your email to keep your place.',
    label: 'Waitlist',
    eyebrow: 'Stealth mode',
    headline: 'You are on the list',
    bodyHtml: [
      `<p style="margin:0 0 16px;">Hi ${name},</p>`,
      '<p style="margin:0 0 18px;">Vorinthex is being built in stealth mode, behind the scenes and in private.</p>',
      '<p style="margin:0 0 22px;">The first doors open in 2027.</p>',
      '<p style="margin:0 0 18px;">I am already building with Vorinthex AI in private.</p>',
      '<p style="margin:0 0 22px;">At 20, I am using it behind the scenes to build and scale apps. The first proof: idea to live on the App Store and Play Store in 20 days.</p>',
      '<p style="margin:0 0 18px;">Vorinthex is being shaped as your hidden AI team for turning app ideas into real products: built, launched, marketed, and grown without needing to become technical first.</p>',
      '<p style="margin:0;">I believe this can help more people turn ideas into real businesses, create new income paths, and build toward greater financial independence.</p>',
    ].join(''),
    actionUrl: input.verifyLink,
    actionLabel: 'Verify email',
    supportingHtml: `Confirm your email to keep your waitlist place. This link expires in 48 hours at ${input.expiresAt.toISOString()}.`,
    footerHtml: 'You received this because this email address was used to join the Vorinthex waitlist.',
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
  return { verifyLink, expiresAt: challenge.expiresAt };
}

export async function requestWaitlistVerification(email: string) {
  const normalized = normalizeWaitlistEmail(email);
  const entry = await upsertUserByEmail(normalized, {
    name: defaultNameFromEmail(normalized),
    isOnWaitlist: true,
    is_subscribed_to_updates: true,
  });
  trackPlatformEvent({
    slug: 'waitlist.signup_submitted',
    userId: entry.key,
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
      is_verified: entry.isVerified,
    },
  });

  if (entry.isVerified) {
    return { email: entry.email, isVerified: true as const };
  }

  const delivery = await sendWaitlistVerificationEmailForUser(entry);

  return {
    email: entry.email,
    isVerified: false as const,
    verificationEmailSent: true,
    expiresAt: delivery.expiresAt,
    devVerifyLink: process.env.NODE_ENV === 'production' ? undefined : delivery.verifyLink,
  };
}

export async function verifyWaitlistEmail(tokenHash: string) {
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

  const entry = await updateUser(challenge.userId, { isVerified: true, updatedAt: now.toISOString() });
  trackPlatformEvent({
    slug: 'waitlist.email_verified',
    userId: entry.key,
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
    },
  });
  return { id: entry.key, email: entry.email, isVerified: entry.isVerified };
}
