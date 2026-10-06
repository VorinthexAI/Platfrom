import { z } from 'zod';
import { logAccountDeletion, serializeDeletionError } from './debug-log';
import { createAccountDeletionRepository, type AccountDeletionRepository } from './repository';
import { invalidatePresenceSessions } from '@/lib/presence/session-state';
import { sendAccountDeletedEmail } from '@/lib/email/lifecycle';

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT' as const;
export const accountDeleteInputSchema = z.object({ confirmation: z.literal(ACCOUNT_DELETE_CONFIRMATION) }).strict();

export function createAccountDeletionService({ repository = createAccountDeletionRepository(), invalidateSessions = invalidatePresenceSessions, sendDeletedEmail = sendAccountDeletedEmail }: { repository?: AccountDeletionRepository; invalidateSessions?: typeof invalidatePresenceSessions; sendDeletedEmail?: typeof sendAccountDeletedEmail } = {}) {
  return Object.freeze({
    async delete(rawInput: unknown, trustedUserKey: string, options: { sendConfirmation?: boolean } = {}) {
      const startedAt = Date.now();
      logAccountDeletion('service.start', { userKey: trustedUserKey, sendConfirmation: options.sendConfirmation !== false });
      try {
        accountDeleteInputSchema.parse(rawInput);
        logAccountDeletion('service.parsed', { userKey: trustedUserKey });
        const fence = await repository.fence(trustedUserKey, new Date().toISOString(), new Date().toISOString());
        logAccountDeletion('service.fence', { userKey: trustedUserKey, status: fence.status, presenceSessionCount: fence.status === 'fenced' ? fence.presenceSessionKeys.length : 0, hasRecipient: fence.status === 'fenced' });
        if (fence.status === 'not_found') {
          logAccountDeletion('service.not-found', { userKey: trustedUserKey, durationMs: Date.now() - startedAt });
          return { deleted: true as const };
        }
        try {
          await invalidateSessions(trustedUserKey, fence.presenceSessionKeys);
          logAccountDeletion('service.sessions-invalidated', { userKey: trustedUserKey, presenceSessionCount: fence.presenceSessionKeys.length });
        } catch (error) {
          logAccountDeletion('service.sessions-invalidate-failed', { userKey: trustedUserKey, error: serializeDeletionError(error) });
          throw error;
        }
        const result = await repository.finalize(trustedUserKey);
        logAccountDeletion('service.finalize', { userKey: trustedUserKey, status: result.status });
        if (result.status === 'deleted' && options.sendConfirmation !== false) {
          await sendDeletedEmail(fence.recipient.email).catch((error: unknown) => {
            logAccountDeletion('service.email-failed', { userKey: trustedUserKey, error: serializeDeletionError(error) });
            console.error('account deletion email delivery failed', { userKey: trustedUserKey, error });
          });
        } else {
          logAccountDeletion('service.email-skipped', { userKey: trustedUserKey, status: result.status, sendConfirmation: options.sendConfirmation !== false });
        }
        logAccountDeletion('service.done', { userKey: trustedUserKey, durationMs: Date.now() - startedAt });
        return { deleted: true as const };
      } catch (error) {
        logAccountDeletion('service.error', { userKey: trustedUserKey, durationMs: Date.now() - startedAt, error: serializeDeletionError(error) });
        throw error;
      }
    },
  });
}
export const accountDeletionService = createAccountDeletionService();
export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
