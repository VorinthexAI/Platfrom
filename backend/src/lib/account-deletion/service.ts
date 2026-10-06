import { z } from 'zod';
import { createAccountDeletionRepository, type AccountDeletionRepository } from './repository';
import { invalidatePresenceSessions } from '@/lib/presence/session-state';
import { sendAccountDeletedEmail } from '@/lib/email/lifecycle';

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT' as const;
export const accountDeleteInputSchema = z.object({ confirmation: z.literal(ACCOUNT_DELETE_CONFIRMATION) }).strict();

export function createAccountDeletionService({ repository = createAccountDeletionRepository(), invalidateSessions = invalidatePresenceSessions, sendDeletedEmail = sendAccountDeletedEmail }: { repository?: AccountDeletionRepository; invalidateSessions?: typeof invalidatePresenceSessions; sendDeletedEmail?: typeof sendAccountDeletedEmail } = {}) {
  return Object.freeze({
    async delete(rawInput: unknown, trustedUserKey: string, options: { sendConfirmation?: boolean } = {}) {
      accountDeleteInputSchema.parse(rawInput);
      const fence = await repository.fence(trustedUserKey, new Date().toISOString(), new Date().toISOString());
      if (fence.status === 'not_found') return { deleted: true as const };
      await invalidateSessions(trustedUserKey, fence.presenceSessionKeys);
      const result = await repository.finalize(trustedUserKey);
      if (result.status === 'deleted' && options.sendConfirmation !== false) await sendDeletedEmail(fence.recipient.email).catch((error: unknown) => console.error('account deletion email delivery failed', { userKey: trustedUserKey, error }));
      return { deleted: true as const };
    },
  });
}
export const accountDeletionService = createAccountDeletionService();
export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
