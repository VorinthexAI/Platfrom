import { z } from 'zod';
import { referralProgramVersionSchema } from './referral-codes.node';

export const REFERRAL_REWARDS_COLLECTION = 'referralRewards';
export const referralMilestoneSchema = z.enum(['signup', 'first-paid']);

const referralRewardShape = {
  key: z.string().trim().min(1).max(200),
  attributionKey: z.string().trim().min(1).max(200),
  referrerUserKey: z.string().trim().min(1).max(200),
  referredUserKey: z.string().trim().min(1).max(200),
  programVersion: referralProgramVersionSchema,
  microSparks: z.number().int().safe().positive(),
  sparkTransactionKey: z.string().trim().min(1).max(200),
  reversalSparkTransactionKey: z.string().trim().min(1).max(200).nullable().default(null),
  reversalDebtMicroSparks: z.number().int().safe().nonnegative().default(0),
  reversedAt: z.string().datetime({ offset: true }).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
};

export const signupReferralRewardSchema = z.object({
  ...referralRewardShape,
  milestone: z.literal('signup'),
  qualifyingPaymentKey: z.never().optional(),
});

export const firstPaidReferralRewardSchema = z.object({
  ...referralRewardShape,
  milestone: z.literal('first-paid'),
  qualifyingPaymentKey: z.string().trim().min(1).max(200),
});

export const referralRewardSchema = z.discriminatedUnion('milestone', [signupReferralRewardSchema, firstPaidReferralRewardSchema]);

export type ReferralMilestone = z.infer<typeof referralMilestoneSchema>;
export type ReferralReward = z.infer<typeof referralRewardSchema>;
