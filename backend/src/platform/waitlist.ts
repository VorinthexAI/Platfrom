import { aql } from 'arangojs';
import { db } from '@/lib/db/client';
import { getUserById, updateUser, USERS_COLLECTION } from '@/lib/db/users.node';
import { requestSignInEmail } from '@/api/auth';
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
      FILTER u.isOnWaitlist == true
      SORT u.email
      RETURN { id: u._key, email: u.email, name: u.name, isVerified: u.isVerified }
  `);
  return cursor.all();
}

export async function acceptWaitlistUser(userId: string) {
  const entry = await getUserById(userId);
  if (!entry) return null;

  await updateUser(entry.key, {
    isOnWaitlist: false,
    isWaitlistApproved: true,
    updatedAt: new Date().toISOString(),
  });
  trackPlatformEvent({
    slug: 'waitlist.user_approved',
    data: {
      user_id: entry.key,
      email_hash: entry.emailHash,
    },
  });

  const signInEmail = await requestSignInEmail(entry.email);
  if (signInEmail.allowed) {
    trackPlatformEvent({
      slug: 'waitlist.signin_invite_sent',
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
