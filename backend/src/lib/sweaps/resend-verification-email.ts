import { listUnverifiedWaitlistUsers } from '@/lib/db/users.node';
import { sendWaitlistVerificationEmailForUser } from '@/api/waitlist';

export interface ResendVerificationEmailSweepDeps {
  listUsers: typeof listUnverifiedWaitlistUsers;
  sendEmail: typeof sendWaitlistVerificationEmailForUser;
}

const defaultDeps: ResendVerificationEmailSweepDeps = {
  listUsers: listUnverifiedWaitlistUsers,
  sendEmail: sendWaitlistVerificationEmailForUser,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function resendVerificationEmailSweep(deps: ResendVerificationEmailSweepDeps = defaultDeps) {
  const users = await deps.listUsers();
  const settled = await Promise.all(users.map(async (user) => {
    try {
      await deps.sendEmail(user);
      return { ok: true as const, userId: user.key, email: user.email };
    } catch (error) {
      console.warn('failed to resend waitlist verification email', {
        userId: user.key,
        email: user.email,
        error: errorMessage(error),
      });
      return { ok: false as const, userId: user.key, email: user.email, error: errorMessage(error) };
    }
  }));

  const results = settled.filter((result) => result.ok);
  const failed = settled.filter((result) => !result.ok);

  return {
    sent: results.length,
    failed: failed.length,
    users: results,
    failures: failed,
  };
}
