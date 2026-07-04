import { getUserByUpdatesUnsubscribeTokenHash, updateUser, type User } from '@/lib/db/users.node';
import { randomToken, sha256 } from '@/lib/crypto';
import { sendMarketingEmail, type MarketingEmailInput } from './email';

const UPDATES_UNSUBSCRIBE_TTL_MS = 15 * 60 * 1000;

export function buildUpdatesUnsubscribeLink(tokenHash: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const url = new URL('/public/updates/unsubscribe', frontendUrl);
  url.searchParams.set('token_hash', tokenHash);
  return url.toString();
}

export function hasUsableUpdatesUnsubscribeRequest(input: {
  is_subscribed_to_updates_unsubscribe_requested_at: string | null;
}, nowMs = Date.now()) {
  if (!input.is_subscribed_to_updates_unsubscribe_requested_at) return false;
  const requestedAt = new Date(input.is_subscribed_to_updates_unsubscribe_requested_at).getTime();
  return Number.isFinite(requestedAt) && requestedAt + UPDATES_UNSUBSCRIBE_TTL_MS > nowMs;
}

export async function createUpdatesUnsubscribeLinkForUser(user: Pick<User, 'key'>) {
  const token = randomToken('vrtx_updates_unsubscribe_');
  const publicTokenHash = await sha256(token);
  const storedTokenHash = await sha256(publicTokenHash);
  const requestedAt = new Date();

  await updateUser(user.key, {
    is_subscribed_to_updates_unsubscribe_token_hash: storedTokenHash,
    is_subscribed_to_updates_unsubscribe_requested_at: requestedAt.toISOString(),
    updatedAt: requestedAt.toISOString(),
  });

  return {
    unsubscribeLink: buildUpdatesUnsubscribeLink(publicTokenHash),
    tokenHash: publicTokenHash,
    expiresAt: new Date(requestedAt.getTime() + UPDATES_UNSUBSCRIBE_TTL_MS),
  };
}

export async function sendUpdatesMarketingEmail(
  user: Pick<User, 'key' | 'email' | 'is_subscribed_to_updates'>,
  input: Omit<MarketingEmailInput, 'to' | 'unsubscribeUrl'>,
) {
  if (!user.is_subscribed_to_updates) {
    return { sent: false as const, reason: 'user is unsubscribed from updates' };
  }

  const { unsubscribeLink, expiresAt } = await createUpdatesUnsubscribeLinkForUser(user);
  await sendMarketingEmail({
    ...input,
    to: user.email,
    unsubscribeUrl: unsubscribeLink,
  });

  return { sent: true as const, expiresAt };
}

export async function unsubscribeFromUpdates(tokenHash: string) {
  const storedTokenHash = await sha256(tokenHash);
  const user = await getUserByUpdatesUnsubscribeTokenHash(storedTokenHash);
  if (!user) return { ok: false as const, error: 'invalid unsubscribe link' };
  if (!hasUsableUpdatesUnsubscribeRequest(user)) {
    return { ok: false as const, error: 'unsubscribe link expired; use the newest unsubscribe link from the latest email' };
  }

  const updated = await updateUser(user.key, {
    is_subscribed_to_updates: false,
    is_subscribed_to_updates_unsubscribe_token_hash: null,
    is_subscribed_to_updates_unsubscribe_requested_at: null,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true as const, email: updated.email, is_subscribed_to_updates: updated.is_subscribed_to_updates };
}
