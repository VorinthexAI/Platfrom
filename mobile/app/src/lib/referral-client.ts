import { z } from "zod";

import { apiClient } from "./api-client";

export const referralCodeSchema = z.string().regex(/^[A-F0-9]{12}$/);

export const referralSummarySchema = z.strictObject({
  code: z.strictObject({
    key: z.string().min(1),
    ownerUserKey: z.string().min(1),
    programVersion: z.literal("v1"),
    code: referralCodeSchema,
    createdAt: z.string().datetime({ offset: true }),
  }),
  attributionCount: z.number().int().nonnegative(),
  signupRewardCount: z.number().int().nonnegative(),
  paidRewardCount: z.number().int().nonnegative(),
  earnedMicroSparks: z.number().int().safe().nonnegative(),
});

const referralSummaryEnvelopeSchema = z.strictObject({ success: z.literal(true), data: referralSummarySchema });

export type ReferralSummary = z.infer<typeof referralSummarySchema>;
export const referralSummaryQueryKey = (userKey: string) => ["referral-summary", userKey] as const;

export async function fetchReferralSummary() {
  const response = await apiClient.get("/referrals/summary");
  return referralSummaryEnvelopeSchema.parse(response.data).data;
}

export function referralLinks(code: string) {
  const validCode = referralCodeSchema.parse(code);
  return {
    universal: `https://vorinthex.com/referral/${validCode}`,
    native: `vorinthexcore://referral/${validCode}`,
  };
}
