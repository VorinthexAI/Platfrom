import { EventEmitter } from 'node:events';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getAuthChallengeByHandoffTokenHash,
  updateAuthChallenge,
  type AuthChallenge,
} from '@/lib/db/auth-challenges.node';
import { getUserById } from '@/lib/db/users.node';
import { generateAlias, pickWelcomeLine } from '@/lib/alias';
import { randomToken, sha256 } from '@/lib/crypto';
import { redisConnection } from '@/lib/redis';
import { trackPlatformEvent } from '@/platform/events';
import { createTotpChallengeForIdentity, issueUserTokens, type LoginIdentityType, type SessionTokens } from './auth';

/**
 * Cross-device sign-in handoff.
 *
 * When a visitor requests a magic link (sign in or waitlist verify), the
 * requesting browser parks a handoff secret in an httpOnly cookie. The
 * emailed link may be opened anywhere — a phone, a mail app's built-in
 * view — and tapping it APPROVES the handoff instead of only signing in
 * the tapping surface. The requesting browser then claims its own session:
 * instantly over SSE while its tab is open, or on its next visit while the
 * approval window holds. The secret is double hashed at rest exactly like
 * challenge tokens, and a claim is single use.
 */

/** How long an approval stays claimable after the link is tapped. */
export const HANDOFF_CLAIM_WINDOW_MS = 20 * 60 * 1000;

const HANDOFF_CHANNEL = 'auth:handoff:events';
const HANDOFF_EVENT = 'handoff-approved';
const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const HANDOFF_HASH_PATTERN = /^[a-f0-9]{64}$/;

const handoffBus = new EventEmitter();
handoffBus.setMaxListeners(0);

let subscriberStarted = false;
/** One Redis SUBSCRIBE per process; local fan-out to every waiting stream. */
function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const subscriber = redisConnection.duplicate();
  subscriber.on('error', (error) => {
    console.warn('handoff subscriber error', error instanceof Error ? error.message : String(error));
  });
  subscriber.subscribe(HANDOFF_CHANNEL).catch((error) => {
    console.warn('handoff subscribe failed', error instanceof Error ? error.message : String(error));
    subscriberStarted = false;
  });
  subscriber.on('message', (_channel, message) => {
    handoffBus.emit(HANDOFF_EVENT, message);
  });
}

/** Mint the handoff pair: the public hash travels, the stored hash rests. */
export async function createHandoffSecret() {
  const token = randomToken('vrtx_handoff_');
  const publicTokenHash = await sha256(token);
  const storedTokenHash = await sha256(publicTokenHash);
  return { publicTokenHash, storedTokenHash };
}

/**
 * Stamp a consumed link's challenge as approved and wake every waiting
 * stream. Safe to call for challenges without a parked handoff (no-op).
 */
export async function approveHandoff(challenge: Pick<AuthChallenge, 'key' | 'handoffTokenHash'>) {
  if (!challenge.handoffTokenHash) return;
  await updateAuthChallenge(challenge.key, { approvedAt: new Date().toISOString() });
  try {
    await redisConnection.publish(HANDOFF_CHANNEL, challenge.handoffTokenHash);
  } catch (error) {
    // The DB stamp is the durable truth; a missed publish only costs the
    // instant wake — the stream's poll tick still notices within seconds.
    console.warn('handoff publish failed', error instanceof Error ? error.message : String(error));
  }
}

export function isHandoffClaimable(
  challenge: Pick<AuthChallenge, 'identityType' | 'approvedAt' | 'handoffClaimedAt'>,
  nowMs = Date.now(),
) {
  if (challenge.handoffClaimedAt !== null) return false;
  if (!challenge.approvedAt) return false;
  const approvedAt = new Date(challenge.approvedAt).getTime();
  return Number.isFinite(approvedAt) && approvedAt + HANDOFF_CLAIM_WINDOW_MS > nowMs;
}

export type HandoffStatus = 'pending' | 'approved' | 'gone';

type HandoffClaimResult =
  | ({
    status: 'authenticated';
    alias: string;
    aliasSlug: string | null;
    waitlistNumber: number | null;
    welcomeLine: string;
  } & SessionTokens)
  | {
    status: 'totp_setup_required' | 'totp_required';
    totpChallengeToken: string;
    expiresAt: Date;
  };

/** Where a parked handoff stands right now, without consuming anything. */
export async function getHandoffStatus(handoffPublicHash: string): Promise<HandoffStatus> {
  const stored = await sha256(handoffPublicHash);
  const challenge = await getAuthChallengeByHandoffTokenHash(stored);
  if (!challenge || challenge.handoffClaimedAt !== null) return 'gone';
  if (isHandoffClaimable(challenge)) return 'approved';
  // An approval past its claim window is gone; an untapped link is pending
  // until the challenge itself expires.
  if (challenge.approvedAt) return 'gone';
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) return 'gone';
  return 'pending';
}

/**
 * One-shot claim: trade an approved handoff for a real explorer session.
 * Single use — the first claim wins, every later attempt is refused.
 */
export async function claimHandoff(handoffPublicHash: string): Promise<HandoffClaimResult | null> {
  const stored = await sha256(handoffPublicHash);
  const challenge = await getAuthChallengeByHandoffTokenHash(stored);
  if (!challenge || !isHandoffClaimable(challenge)) return null;

  await updateAuthChallenge(challenge.key, { handoffClaimedAt: new Date().toISOString() });

  const user = await getUserById(challenge.identityKey);
  if (!user) return null;

  if (challenge.identityType !== 'user') {
    const totp = await createTotpChallengeForIdentity(
      challenge.identityType as LoginIdentityType,
      challenge.identityKey,
    );
    if (!totp) return null;
    return {
      status: totp.status,
      totpChallengeToken: totp.totpChallengeToken,
      expiresAt: totp.expiresAt,
    };
  }

  const tokens = await issueUserTokens(user);
  const alias = user.alias ?? generateAlias(user.key);
  trackPlatformEvent({
    slug: 'auth.magic_link_authenticated',
    userId: user.key,
    data: { user_id: user.key, email_hash: user.emailHash, via: 'handoff' },
  });
  return {
    status: 'authenticated' as const,
    ...tokens,
    alias,
    aliasSlug: user.alias_slug,
    waitlistNumber: user.waitlistNumber,
    welcomeLine: pickWelcomeLine(user.key, alias),
  };
}

/**
 * GET /auth/handoff/stream?handoff=… — SSE feed for a waiting sign-in
 * screen. Emits a `handoff` event with the current status on connect, then
 * again the moment the link is tapped (Redis wake) or a poll tick notices.
 * The client claims via POST /auth/handoff/claim and closes the stream.
 */
export async function streamHandoff(c: Context) {
  const handoff = c.req.query('handoff');
  if (!handoff || !HANDOFF_HASH_PATTERN.test(handoff)) {
    return c.json({ error: 'invalid handoff token' }, 400);
  }
  const stored = await sha256(handoff);
  ensureSubscriber();

  return streamSSE(c, async (stream) => {
    let lastStatus: HandoffStatus | null = null;
    let eventId = 0;
    let chain: Promise<void> = Promise.resolve();

    const send = (force: boolean) => {
      chain = chain.then(async () => {
        const status = await getHandoffStatus(handoff);
        if (!force && status === lastStatus) return;
        lastStatus = status;
        eventId += 1;
        await stream.writeSSE({
          event: 'handoff',
          data: JSON.stringify({ status }),
          id: String(eventId),
        });
      }).catch((error) => {
        console.warn('handoff emit failed', error instanceof Error ? error.message : String(error));
      });
      return chain;
    };

    const onApproved = (message: string) => {
      if (message === stored) void send(false);
    };
    handoffBus.on(HANDOFF_EVENT, onApproved);
    const poll = setInterval(() => { void send(false); }, POLL_INTERVAL_MS);
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });

    try {
      await send(true);
      await closed;
    } finally {
      clearInterval(poll);
      clearInterval(heartbeat);
      handoffBus.off(HANDOFF_EVENT, onApproved);
    }
  });
}
