import { sendBrandedEmail } from '@/api/email';
import {
  getUserFragmentPlace,
  listRankedCollectors,
} from '@/lib/db/intelligence-fragments.node';
import {
  getLatestChangeForUser,
  insertUserWaitlistLeaderboardChange,
  listChangesForUserSince,
} from '@/lib/db/user-waitlist-leaderboard-changes.node';
import { getUserById } from '@/lib/db/users.node';
import { formatFragments } from '@/lib/format';
import { newId } from '@/lib/ids';
import { trackPlatformEvent } from './events';

/**
 * The waitlist-leaderboard movement ledger and its daily digest.
 *
 * Movements: every collect re-derives the collector's place straight from
 * the fragments ledger and, when it differs from their last recorded
 * place, appends a userWaitlistLeaderboardChanges node {place, prevPlace}.
 * The daily sweep does the same derivation for EVERY collector before
 * summarizing, so passive movement (rivals passing you) is recorded with
 * the same fidelity as active climbing.
 *
 * Digest: one short email per verified user with at least one fragment
 * entry — how many places they won or lost over the last 24 hours (or
 * that they held), their formatted fragment total, and the reason to get
 * back out there.
 */

const DIGEST_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** The Redis day-lock outlives the day so redeploys never double-send. */
const DIGEST_LOCK_TTL_SECONDS = 26 * 60 * 60;

/**
 * Re-derives the user's current place and appends a movement node when it
 * changed. Returns the current place (or null when they have no entries).
 */
export async function recordUserPlaceIfChanged(userId: string): Promise<number | null> {
  const standing = await getUserFragmentPlace(userId);
  if (!standing) return null;
  const latest = await getLatestChangeForUser(userId);
  if (latest?.place !== standing.place) {
    await insertUserWaitlistLeaderboardChange({
      key: newId(),
      userId,
      place: standing.place,
      prevPlace: latest?.place ?? null,
      createdAt: new Date().toISOString(),
    });
  }
  return standing.place;
}

/** Fire-and-forget wrapper for the collect hot path. */
export function trackUserPlaceChange(userId: string) {
  void recordUserPlaceIfChanged(userId).catch((error) => {
    console.warn('failed to record leaderboard place change', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function digestCopy(delta: number, place: number, totalText: string) {
  const placeText = `place ${place}`;
  if (delta > 0) {
    const places = delta === 1 ? 'one place' : `${delta} places`;
    return {
      subject: `The Hunt: you climbed ${places}`,
      headline: `Up ${places} in The Hunt.`,
      body: `You climbed ${places} in the last day and now hold ${placeText} in The Hunt, with ${totalText} Intelligence Fragments collected.`,
    };
  }
  if (delta < 0) {
    const places = delta === -1 ? 'one place' : `${Math.abs(delta)} places`;
    return {
      subject: `The Hunt: you slipped ${places}`,
      headline: `Rivals moved in The Hunt.`,
      body: `You lost ${places} in the last day and now hold ${placeText} in The Hunt, with ${totalText} Intelligence Fragments collected.`,
    };
  }
  return {
    subject: 'The Hunt: you are holding your place',
    headline: 'Holding steady in The Hunt.',
    body: `You held ${placeText} in The Hunt over the last day, with ${totalText} Intelligence Fragments collected.`,
  };
}

async function sendDigestForUser(userId: string, sinceIso: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user?.isVerified) return false;

  // Record any movement the ledger has not seen yet (passive falls), so
  // the window below always ends on the user's true current place.
  const currentPlace = await recordUserPlaceIfChanged(userId);
  const standing = await getUserFragmentPlace(userId);
  if (currentPlace === null || !standing) return false;

  // Movement over the window: from the place they held as the window
  // opened (the prev of the first change inside it) to where they are now.
  const changes = await listChangesForUserSince(userId, sinceIso);
  const placeAtWindowStart = changes.length > 0
    ? (changes[0]!.prevPlace ?? currentPlace)
    : currentPlace;
  const delta = placeAtWindowStart - currentPlace;

  const totalText = formatFragments(standing.total);
  const copy = digestCopy(delta, currentPlace, totalText);
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

  await sendBrandedEmail({
    to: user.email,
    subject: copy.subject,
    preheader: copy.body,
    label: 'The Hunt',
    eyebrow: 'Daily standing',
    headline: copy.headline,
    bodyHtml: `${copy.body} Explore the galaxy, collect more Intelligence Fragments, and defend your standing before launch. The higher you stand, the greater your prizes, offers, and early access.`,
    actionUrl: new URL('/hunt', frontendUrl).toString(),
    actionLabel: 'Explore the galaxy',
    supportingHtml: 'Crystals worth up to a million fragments are hiding inside asteroids right now.',
    footerHtml: 'You received this because this email holds a place in The Hunt.',
  });

  trackPlatformEvent({
    slug: 'leaderboard.daily_digest_sent',
    userId,
    data: {
      user_id: userId,
      place: currentPlace,
      prev_place: placeAtWindowStart,
      delta,
      fragments_total: standing.total,
    },
  });
  return true;
}

/** One full digest run: every collector, verified users get the email. */
export async function runLeaderboardDailyDigest(): Promise<{ sent: number; skipped: number }> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ranked = await listRankedCollectors();
  let sent = 0;
  let skipped = 0;
  for (const collector of ranked) {
    try {
      if (await sendDigestForUser(collector.userId, sinceIso)) {
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      console.warn('leaderboard digest failed for user', {
        userId: collector.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.info('leaderboard daily digest complete', { sent, skipped });
  return { sent, skipped };
}

let digestSweeperStarted = false;

/**
 * Hourly tick that sends the digest exactly once per UTC day across all
 * instances: whichever process wins the Redis day-key runs it.
 */
export function ensureLeaderboardDigestSweeper() {
  if (digestSweeperStarted) return;
  digestSweeperStarted = true;

  const tick = async () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const { redisConnection } = await import('@/lib/redis');
      const acquired = await redisConnection.set(
        `leaderboard-digest:${day}`,
        '1',
        'EX',
        DIGEST_LOCK_TTL_SECONDS,
        'NX',
      );
      if (acquired !== 'OK') return;
      await runLeaderboardDailyDigest();
    } catch (error) {
      console.warn('leaderboard digest tick failed', error instanceof Error ? error.message : String(error));
    }
  };

  setInterval(() => { void tick(); }, DIGEST_CHECK_INTERVAL_MS);
  void tick();
}
