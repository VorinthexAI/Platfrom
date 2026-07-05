import { aql } from 'arangojs';
import { db } from '@/lib/db/client';
import { MEMBERS_COLLECTION } from '@/lib/db/members.node';
import { getUserById, updateUser, USERS_COLLECTION } from '@/lib/db/users.node';
import { requestSignInEmail } from '@/api/auth';
import { upsertMemberForUser } from '@/api/users';
import { trackPlatformEvent } from './events';

export interface PendingWaitlistUser {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

export async function listPendingWaitlistUsers(): Promise<PendingWaitlistUser[]> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      LET member = FIRST(
        FOR m IN ${db.collection(MEMBERS_COLLECTION)}
          FILTER m.userId == u._key
          LIMIT 1
          RETURN 1
      )
      FILTER member == null
      SORT u.email
      RETURN { id: u._key, email: u.email, name: u.name, isVerified: u.isVerified }
  `);
  return cursor.all();
}

export async function acceptWaitlistUser(userId: string) {
  const entry = await getUserById(userId);
  if (!entry) return null;

  await updateUser(entry.key, { updatedAt: new Date().toISOString() });
  await upsertMemberForUser(entry);
  trackPlatformEvent({
    slug: 'waitlist.user_approved',
    userId: entry.key,
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
    },
  });

  const signInEmail = await requestSignInEmail(entry.email);
  if (signInEmail.allowed) {
    trackPlatformEvent({
      slug: 'waitlist.signin_invite_sent',
      userId: entry.key,
      data: {
        user_id: entry.key,
        email_hash: entry.emailHash,
        expires_at: signInEmail.expiresAt.toISOString(),
      },
    });
  }
  return {
    user_id: entry.key,
    email: entry.email,
    sign_in_email_sent: signInEmail.allowed,
    expires_at: signInEmail.allowed ? signInEmail.expiresAt : null,
  };
}
