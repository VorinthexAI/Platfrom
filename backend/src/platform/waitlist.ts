import { getUserById, listUnverifiedWaitlistUsers, updateUser } from '@/lib/db/users.node';
import { requestSignInEmail } from '@/api/auth';
import { trackPlatformEvent } from './events';

export interface PendingWaitlistUser {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

export async function listPendingWaitlistUsers(): Promise<PendingWaitlistUser[]> {
  const users = await listUnverifiedWaitlistUsers();
  return users
    .map((user) => ({ id: user.key, email: user.email, name: user.name, isVerified: user.isVerified }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function acceptWaitlistUser(userId: string) {
  const entry = await getUserById(userId);
  if (!entry) return null;

  const now = new Date().toISOString();
  const updated = entry.isVerified
    ? entry
    : await updateUser(entry.key, { isVerified: true, updatedAt: now });
  trackPlatformEvent({
    slug: 'waitlist.user_approved',
    userId: updated.key,
    data: {
      user_id: updated.key,
      email_hash: updated.emailHash,
    },
  });

  const signInEmail = await requestSignInEmail(updated.email);
  if (signInEmail.allowed) {
    trackPlatformEvent({
      slug: 'waitlist.signin_invite_sent',
      userId: updated.key,
      data: {
        user_id: updated.key,
        email_hash: updated.emailHash,
        expires_at: signInEmail.expiresAt.toISOString(),
      },
    });
  }
  return {
    user_id: updated.key,
    email: updated.email,
    sign_in_email_sent: signInEmail.allowed,
    expires_at: signInEmail.allowed ? signInEmail.expiresAt : null,
  };
}
