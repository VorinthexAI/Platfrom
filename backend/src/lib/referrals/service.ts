import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { publishUserEvent } from '@/api/events';
import { REFERRAL_PAID_REWARD_MICRO_SPARKS, REFERRAL_PROGRAM_VERSION, REFERRAL_SIGNUP_REWARD_MICRO_SPARKS } from '@/lib/costs';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { referralCodeSchema, referralCodeValueSchema } from '@/lib/db/referral-codes.node';
import { newId } from '@/lib/ids';
import { qualifyingPaymentKeySchema, rawReferralCodeSchema, referralRedeemResultSchema, referralRedemptionStatusSchema, referralUserKeySchema } from './contracts';
import { createArangoReferralRepository, type ReferralRepository } from './repository';

export function normalizeReferralCode(rawCode: unknown): string {
  return referralCodeValueSchema.parse(rawReferralCodeSchema.parse(rawCode).toUpperCase());
}

export interface ReferralServiceDependencies {
  repository: ReferralRepository;
  createKey?: () => string;
  createCode?: () => string;
  now?: () => Date;
  publishReward?: typeof publishUserEvent;
}

export function createReferralService({ repository, createKey = newId, createCode = () => randomBytes(6).toString('hex').toUpperCase(), now = () => new Date(), publishReward = publishUserEvent }: ReferralServiceDependencies) {
  async function ensurePersonalCode(rawUserKey: unknown) {
    const ownerUserKey = referralUserKeySchema.parse(rawUserKey);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = referralCodeSchema.parse({ key: createKey(), ownerUserKey, programVersion: REFERRAL_PROGRAM_VERSION, code: normalizeReferralCode(createCode()), createdAt: now().toISOString() });
      try {
        return await repository.ensureCode(code);
      } catch (error) {
        if (!isArangoUniqueConstraintError(error) || attempt === 4) throw error;
      }
    }
    throw new Error('Unable to allocate a unique referral code.');
  }

  async function publish(result: { attribution: { referrerUserKey: string } }) {
    await publishReward(result.attribution.referrerUserKey, 'referral.reward.created').catch(() => undefined);
  }

  async function completeVerifiedReferral(rawReferredUserKey: unknown, rawCode: unknown) {
    const referredUserKey = referralUserKeySchema.parse(rawReferredUserKey);
    const normalizedCode = normalizeReferralCode(rawCode);
    const createdAt = now().toISOString();
    const attributionKey = createKey();
    const transactionKey = createKey();
    const result = await repository.completeVerifiedReferral({
      referredUserKey,
      normalizedCode,
      attribution: { key: attributionKey, referredUserKey, programVersion: REFERRAL_PROGRAM_VERSION, createdAt },
      signup: { rewardKey: createKey(), transactionKey, microSparks: REFERRAL_SIGNUP_REWARD_MICRO_SPARKS, createdAt },
      firstPaid: { rewardKey: createKey(), transactionKey: createKey(), microSparks: REFERRAL_PAID_REWARD_MICRO_SPARKS, createdAt },
    });
    await publish(result);
    return result;
  }

  return Object.freeze({
    ensurePersonalCode,
    async readSummary(rawUserKey: unknown) {
      const userKey = referralUserKeySchema.parse(rawUserKey);
      return repository.readSummary(userKey);
    },
    async readRedemptionStatus(rawUserKey: unknown) {
      return referralRedemptionStatusSchema.parse(await repository.readRedemptionStatus(referralUserKeySchema.parse(rawUserKey)));
    },
    async redeem(rawReferredUserKey: unknown, rawCode: unknown) {
      const completion = await completeVerifiedReferral(rawReferredUserKey, rawCode);
      const redemption = await repository.readRedemptionStatus(referralUserKeySchema.parse(rawReferredUserKey));
      return referralRedeemResultSchema.parse({ status: completion.status, ...redemption });
    },
    completeVerifiedReferral,
    async applyFirstPaidReward(trustedReferredUserKey: unknown, rawQualifyingPaymentKey: unknown) {
      const result = await repository.applyFirstPaidReward({ referredUserKey: referralUserKeySchema.parse(trustedReferredUserKey), qualifyingPaymentKey: qualifyingPaymentKeySchema.parse(rawQualifyingPaymentKey), rewardKey: createKey(), transactionKey: createKey(), createdAt: now().toISOString(), microSparks: REFERRAL_PAID_REWARD_MICRO_SPARKS });
      if (result.status === 'applied' || result.status === 'replayed') await publish(result);
      return result;
    },
    async reverseFirstPaidReward(rawQualifyingPaymentKey: unknown, rawReversedAt: unknown) {
      const result = await repository.reverseFirstPaidReward(qualifyingPaymentKeySchema.parse(rawQualifyingPaymentKey), z.string().datetime({ offset: true }).parse(rawReversedAt));
      if (result.status !== 'not-found') await publishReward(result.referrerUserKey, 'referral.reward.created').catch(() => undefined);
      return result;
    },
  });
}

export const referralService = createReferralService({ repository: createArangoReferralRepository() });
export type ReferralService = ReturnType<typeof createReferralService>;
