import { referralService } from '@/lib/referrals/service';
import { normalizeReferralCode } from '@/lib/referrals/service';
import { ReferralRepositoryError } from '@/lib/referrals/repository';
import { getUserById, updateUser } from '@/lib/db/users.node';

interface VerifiedReferralInput {
  userKey: string;
  wasVerified: boolean;
  referralCode: string | null | undefined;
}

interface VerifiedReferralDependencies {
  completeReferral?: typeof referralService.completeVerifiedReferral;
  getUser?: typeof getUserById;
  updateUser?: typeof updateUser;
  warn?: (message: string, detail: string) => void;
}

/** Applies a newly supplied referral or retries one persisted by a previous verified authentication. */
export async function completeReferralForNewlyVerifiedUser(
  input: VerifiedReferralInput,
  dependencies: VerifiedReferralDependencies = {},
): Promise<void> {
  const update = dependencies.updateUser ?? updateUser;
  const get = dependencies.getUser ?? getUserById;
  let supplied: string | null = null;
  try {
    supplied = !input.wasVerified && input.referralCode ? normalizeReferralCode(input.referralCode) : null;
  } catch (error) {
    (dependencies.warn ?? console.warn)('verified referral completion failed', error instanceof Error ? error.message : String(error));
    return;
  }
  if (supplied) await update(input.userKey, { pendingReferralCode: supplied, updatedAt: new Date().toISOString() });
  const pending = supplied ?? (await get(input.userKey))?.pendingReferralCode;
  if (!pending) return;
  try {
    await (dependencies.completeReferral ?? referralService.completeVerifiedReferral)(input.userKey, pending);
    await update(input.userKey, { pendingReferralCode: null, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ReferralRepositoryError && ['INVALID_CODE', 'SELF_REFERRAL', 'REFERRAL_CODE_MISSING'].includes(error.code)) {
      await update(input.userKey, { pendingReferralCode: null, updatedAt: new Date().toISOString() });
    }
    (dependencies.warn ?? console.warn)('verified referral completion failed', error instanceof Error ? error.message : String(error));
  }
}
