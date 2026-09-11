import { z } from 'zod';
import { createAccountDeletionRepository, type AccountDeletionRepository } from './repository';
import { commerceService, type CommerceService } from '@/lib/commerce/service';
import { invalidatePresenceSessions } from '@/lib/presence/session-state';
import { sendAccountDeletedEmail } from '@/lib/email/lifecycle';

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT' as const;
export const accountDeleteInputSchema = z.object({ confirmation: z.literal(ACCOUNT_DELETE_CONFIRMATION) }).strict();

export class AccountDeletionError extends Error {
  constructor(public readonly code: 'ACCOUNT_SHARED_ACCESS' | 'ACCOUNT_ACTIVE_CHECKOUT', message: string) { super(message); this.name = 'AccountDeletionError'; }
}

export interface AccountDeletionServiceDependencies {
  repository?: AccountDeletionRepository;
  commerce?: Pick<CommerceService, 'recoverUserPendingCheckouts' | 'revokeUserSubscriptions'>;
  invalidateSessions?: typeof invalidatePresenceSessions;
  sendDeletedEmail?: typeof sendAccountDeletedEmail;
}

export function createAccountDeletionService(dependencies: AccountDeletionServiceDependencies = {}) {
  const repository = dependencies.repository ?? createAccountDeletionRepository();
  const commerce = dependencies.commerce ?? commerceService;
  const invalidateSessions = dependencies.invalidateSessions ?? invalidatePresenceSessions;
  const sendDeletedEmail = dependencies.sendDeletedEmail ?? sendAccountDeletedEmail;
  return Object.freeze({
    async delete(rawInput: unknown, trustedUserKey: string, options: { sendConfirmation?: boolean } = {}) {
      accountDeleteInputSchema.parse(rawInput);
      const requestedAt = new Date().toISOString();
      const pendingCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      let fence = await repository.fence(trustedUserKey, pendingCutoff, requestedAt);
      if (fence.status === 'checkout_recovery_required') {
        await commerce.recoverUserPendingCheckouts(trustedUserKey, pendingCutoff);
        fence = await repository.fence(trustedUserKey, pendingCutoff, requestedAt);
      }
      if (fence.status === 'not_found') return { deleted: true as const };
      if (fence.status === 'shared_access') throw new AccountDeletionError('ACCOUNT_SHARED_ACCESS', 'Account deletion is blocked while a team or scope is shared with another active user.');
      if (fence.status !== 'fenced') throw new AccountDeletionError('ACCOUNT_ACTIVE_CHECKOUT', 'Account deletion is blocked while a payment checkout is pending or open. Complete or let the checkout expire before retrying.');

      // No Arango transaction is open while provider and Redis operations run.
      // The durable fence prevents new checkout and authenticated presence work.
      await commerce.revokeUserSubscriptions(trustedUserKey);
      await invalidateSessions(trustedUserKey, fence.presenceSessionKeys);
      const result = await repository.finalize(trustedUserKey);
      if (result.status === 'shared_access') throw new AccountDeletionError('ACCOUNT_SHARED_ACCESS', 'Account ownership changed during deletion; retry after removing shared access.');
      if (result.status === 'active_checkout') throw new AccountDeletionError('ACCOUNT_ACTIVE_CHECKOUT', 'A payment checkout became active before the deletion fence was established.');
      if (result.status === 'deleted' && options.sendConfirmation !== false) await sendDeletedEmail(fence.recipient.email).catch((error) => console.error('account deletion email delivery failed', { userKey: trustedUserKey, error }));
      return { deleted: true as const };
    },
  });
}

export const accountDeletionService = createAccountDeletionService();
export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
