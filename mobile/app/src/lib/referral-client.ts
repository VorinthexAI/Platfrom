import { isAxiosError } from "axios";
import { z } from "zod";

import { apiClient } from "./api-client";
import { extractDomainErrorCode } from "./domain-error-observer";

export const referralCodeSchema = z.string().regex(/^[A-F0-9]{12}$/);
export const referralRedeemRequestSchema = z.strictObject({ code: referralCodeSchema });
export const referralRedeemResultSchema = z.strictObject({
  status: z.enum(["applied", "replayed"]),
  attributed: z.literal(true),
  referrerName: z.string().trim().min(1).max(200).nullable(),
  signupRewardIssued: z.literal(true),
  firstPaidRewardStatus: z.enum(["pending", "earned", "reversed"]),
});
const referralRedeemEnvelopeSchema = z.strictObject({ success: z.literal(true), data: referralRedeemResultSchema });

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
  invitees: z.array(z.strictObject({
    displayName: z.string().trim().min(1).max(200).nullable(),
    signupRewardEarned: z.boolean(),
    firstPaidRewardStatus: z.enum(["pending", "earned", "reversed"]),
  })).max(100),
});

const referralSummaryEnvelopeSchema = z.strictObject({ success: z.literal(true), data: referralSummarySchema });
const legacyReferralSummaryEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  data: referralSummarySchema.omit({ invitees: true }),
});

export type ReferralSummary = z.infer<typeof referralSummarySchema>;
export type ReferralRedeemResult = z.infer<typeof referralRedeemResultSchema>;
export const referralSummaryQueryKey = (userKey: string) => ["referral-summary", userKey] as const;

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase();
}

export async function redeemReferralCode(value: string) {
  const body = referralRedeemRequestSchema.parse({ code: normalizeReferralCode(value) });
  const response = await apiClient.post("/referrals/redeem", body);
  return referralRedeemEnvelopeSchema.parse(response.data).data;
}

export function referralRedemptionErrorMessage(error: unknown) {
  switch (extractDomainErrorCode(error)) {
    case "INVALID_CODE": return "That referral code was not found.";
    case "SELF_REFERRAL": return "You cannot use your own referral code.";
    case "ALREADY_ATTRIBUTED": return "A different referral code is already applied to this account.";
    case "USER_NOT_VERIFIED": return "Verify your account before using a referral code.";
    default: return "The referral code could not be applied. Please try again.";
  }
}

export async function fetchReferralSummary() {
  try {
    const response = await apiClient.get("/referrals/summary", { params: { includeInvitees: "true" } });
    return referralSummaryEnvelopeSchema.parse(response.data).data;
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 400) throw error;
    const response = await apiClient.get("/referrals/summary");
    return { ...legacyReferralSummaryEnvelopeSchema.parse(response.data).data, invitees: [] };
  }
}

export function referralLinks(code: string) {
  const validCode = referralCodeSchema.parse(code);
  return {
    universal: `https://vorinthex.com/referral/${validCode}`,
    native: `vorinthexcore://referral/${validCode}`,
  };
}
