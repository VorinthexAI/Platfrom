import { z } from 'zod';
import { referralAttributionSchema } from '@/lib/db/referral-attributions.node';
import { referralCodeSchema } from '@/lib/db/referral-codes.node';
import { firstPaidReferralRewardSchema, signupReferralRewardSchema } from '@/lib/db/referral-rewards.node';

export const referralUserKeySchema = z.string().trim().min(1).max(200);
export const rawReferralCodeSchema = z.string().trim().min(1).max(64);
export const qualifyingPaymentKeySchema = z.string().trim().min(1).max(200);
export const referralSummaryReadInputSchema = z.object({}).strict();
const publicReferralCodeSchema = referralCodeSchema.strict();
const publicReferralAttributionSchema = referralAttributionSchema.strict();
const publicReferralRewardSchema = z.discriminatedUnion('milestone', [signupReferralRewardSchema.strict(), firstPaidReferralRewardSchema.strict()]);

export const referralSummarySchema = z.object({
  code: publicReferralCodeSchema,
  attributionCount: z.number().int().nonnegative(),
  signupRewardCount: z.number().int().nonnegative(),
  paidRewardCount: z.number().int().nonnegative(),
  earnedMicroSparks: z.number().int().safe().nonnegative(),
}).strict();

export const referralCompletionSchema = z.object({
  status: z.enum(['applied', 'replayed']),
  attribution: publicReferralAttributionSchema,
  reward: publicReferralRewardSchema,
}).strict();

export const paidReferralRewardResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-attributed') }).strict(),
  referralCompletionSchema,
]);

export type ReferralSummary = z.infer<typeof referralSummarySchema>;
export type ReferralCompletion = z.infer<typeof referralCompletionSchema>;
export type PaidReferralRewardResult = z.infer<typeof paidReferralRewardResultSchema>;
