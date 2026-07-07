import { aql } from 'arangojs';
import { db } from '@/lib/db/client';
import { MEMBERS_COLLECTION } from '@/lib/db/members.node';
import { upsertMemberByKeyGuarded } from '@/lib/db/identity-guard';
import { getUserById, updateUser, USERS_COLLECTION } from '@/lib/db/users.node';
import { requestSignInEmail } from '@/api/auth';
import { newId } from '@/lib/ids';
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
          FILTER m.emailHash == u.emailHash
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
  await upsertMemberByKeyGuarded({
    key: newId(),
    platformId: entry.platformId,
    email: entry.email,
    emailHash: entry.emailHash,
    name: entry.name,
    profileUrl: entry.profileUrl,
    role: 'viewer',
    isMfaEnabled: false,
    has_request_mfa_reset_link: false,
    refreshTokenHash: null,
    totpSecret: null,
    lastTotpTimeStep: null,
    requested_mfa_reset_link_at: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embedding: [],
  });
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
