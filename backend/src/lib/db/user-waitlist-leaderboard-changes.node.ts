import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USER_WAITLIST_LEADERBOARD_CHANGES_COLLECTION = 'userWaitlistLeaderboardChanges';

/**
 * One node per leaderboard movement: whenever a user's place on the
 * waitlist leaderboard changes (a collect pushed them up, or rivals
 * pushed them down), a new entry records the place they landed on and
 * the place they held before. The daily digest reads a user's entries
 * from the last 24 hours to tell them exactly how far they climbed or
 * fell — users and their fragments stay the ranking's source of truth;
 * this ledger only records the movements.
 */
export const userWaitlistLeaderboardChangeSchema = z.object({
  key: z.string(),
  userId: z.string(),
  /** 1-based place on the leaderboard after this change. */
  place: z.number().int().min(1),
  /** Place before this change; null for the user's first-ever entry. */
  prevPlace: z.number().int().min(1).nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type UserWaitlistLeaderboardChange = z.infer<typeof userWaitlistLeaderboardChangeSchema>;

// Movement records are numeric bookkeeping — nothing worth embedding.
const helpers = createNodeHelpers(
  USER_WAITLIST_LEADERBOARD_CHANGES_COLLECTION,
  userWaitlistLeaderboardChangeSchema,
  [],
);

export const insertUserWaitlistLeaderboardChange = helpers.insert;
export const getUserWaitlistLeaderboardChangeById = helpers.getById;
export const listUserWaitlistLeaderboardChangesPage = helpers.listPage;

/** The user's most recent movement record (their last known place). */
export async function getLatestChangeForUser(
  userId: string,
): Promise<UserWaitlistLeaderboardChange | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(USER_WAITLIST_LEADERBOARD_CHANGES_COLLECTION)}
      FILTER c.userId == ${userId}
      SORT c.createdAt DESC
      LIMIT 1
      RETURN c
  `);
  const doc = await cursor.next();
  return doc ? userWaitlistLeaderboardChangeSchema.parse(withArangoKey(doc)) : null;
}

/** All of a user's movements since a timestamp, oldest first. */
export async function listChangesForUserSince(
  userId: string,
  sinceIso: string,
): Promise<UserWaitlistLeaderboardChange[]> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(USER_WAITLIST_LEADERBOARD_CHANGES_COLLECTION)}
      FILTER c.userId == ${userId} && c.createdAt >= ${sinceIso}
      SORT c.createdAt ASC
      RETURN c
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userWaitlistLeaderboardChangeSchema.parse(withArangoKey(doc)));
}
