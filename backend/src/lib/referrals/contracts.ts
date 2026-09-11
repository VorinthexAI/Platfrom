import { z } from 'zod';
import { referralAttributionSchema } from '@/lib/db/referral-attributions.node';
import { referralCodeSchema } from '@/lib/db/referral-codes.node';
import { firstPaidReferralRewardSchema, signupReferralRewardSchema } from '@/lib/db/referral-rewards.node';

export const referralUserKeySchema = z.string().trim().min(1).max(200);
export const rawReferralCodeSchema = z.string().trim().min(1).max(64);
export const qualifyingPaymentKeySchema = z.string().trim().min(1).max(200);
export const referralSummaryReadInputSchema = z.object({}).strict();
export const referralRedeemInputSchema = z.object({ code: rawReferralCodeSchema }).strict();
const publicReferralCodeSchema = referralCodeSchema.strict();
const publicReferralAttributionSchema = referralAttributionSchema.strict();
const publicReferralRewardSchema = z.discriminatedUnion('milestone', [signupReferralRewardSchema.strict(), firstPaidReferralRewardSchema.strict()]);
const referralInviteeSchema = z.object({
  displayName: z.string().trim().min(1).max(200).nullable(),
  signupRewardEarned: z.boolean(),
  firstPaidRewardStatus: z.enum(['pending', 'earned', 'reversed']),
}).strict();

export const referralSummarySchema = z.object({
  code: publicReferralCodeSchema,
  attributionCount: z.number().int().nonnegative(),
  signupRewardCount: z.number().int().nonnegative(),
  paidRewardCount: z.number().int().nonnegative(),
  earnedMicroSparks: z.number().int().safe().nonnegative(),
  invitees: z.array(referralInviteeSchema).max(100),
}).strict();

export const referralCompletionSchema = z.object({
  status: z.enum(['applied', 'replayed']),
  attribution: publicReferralAttributionSchema,
  reward: publicReferralRewardSchema,
}).strict();

export const paidReferralRewardResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-attributed') }).strict(),
  z.object({ status: z.literal('not-eligible') }).strict(),
  referralCompletionSchema,
]);

export const referralRedemptionStatusSchema = z.object({
  attributed: z.boolean(),
  referrerName: z.string().trim().min(1).max(200).nullable(),
  signupRewardIssued: z.boolean(),
  firstPaidRewardStatus: z.enum(['pending', 'earned', 'reversed']).nullable(),
}).strict();

export const referralRedeemResultSchema = referralRedemptionStatusSchema.extend({
  status: z.enum(['applied', 'replayed']),
  attributed: z.literal(true),
  signupRewardIssued: z.literal(true),
  firstPaidRewardStatus: z.enum(['pending', 'earned', 'reversed']),
}).strict();

export type ReferralSummary = z.infer<typeof referralSummarySchema>;
export type ReferralCompletion = z.infer<typeof referralCompletionSchema>;
export type PaidReferralRewardResult = z.infer<typeof paidReferralRewardResultSchema>;
export type ReferralRedemptionStatus = z.infer<typeof referralRedemptionStatusSchema>;
