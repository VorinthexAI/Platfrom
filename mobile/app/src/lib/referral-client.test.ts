import { expect, mock, test } from "bun:test";

const get = mock(() => Promise.resolve({ data: {} }));
const post = mock(() => Promise.resolve({ data: {} }));
mock.module("./api-client", () => ({ apiClient: { get, post } }));

const { fetchReferralSummary, normalizeReferralCode, redeemReferralCode, referralCodeSchema, referralRedeemRequestSchema, referralRedeemResultSchema, referralRedemptionErrorMessage, referralSummarySchema } = await import("./referral-client");

const summary = {
  code: { key: "code", ownerUserKey: "owner", programVersion: "v1" as const, code: "0123456789AB", createdAt: "2026-09-05T10:00:00.000Z" },
  attributionCount: 1,
  signupRewardCount: 1,
  paidRewardCount: 0,
  earnedMicroSparks: 50_000_000,
  invitees: [{ displayName: "Invited Friend", signupRewardEarned: true, firstPaidRewardStatus: "pending" as const }],
};

test("parses privacy-safe referral invitee milestone status", () => {
  expect(referralSummarySchema.parse(summary).invitees).toEqual(summary.invitees);
  expect(() => referralSummarySchema.parse({ ...summary, invitees: [{ ...summary.invitees[0], email: "private@example.com" }] })).toThrow();
  expect(() => referralSummarySchema.parse({ ...summary, invitees: [{ ...summary.invitees[0], firstPaidRewardStatus: "unknown" }] })).toThrow();
});

test("requests invitees explicitly", async () => {
  get.mockResolvedValueOnce({ data: { success: true, data: summary } });
  await expect(fetchReferralSummary()).resolves.toEqual(summary);
  expect(get).toHaveBeenLastCalledWith("/referrals/summary", { params: { includeInvitees: "true" } });
});

test("accepts the legacy summary while an older backend is deployed", async () => {
  const legacySummary = {
    code: summary.code,
    attributionCount: summary.attributionCount,
    signupRewardCount: summary.signupRewardCount,
    paidRewardCount: summary.paidRewardCount,
    earnedMicroSparks: summary.earnedMicroSparks,
  };
  get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 } });
  get.mockResolvedValueOnce({ data: { success: true, data: legacySummary } });
  await expect(fetchReferralSummary()).resolves.toEqual({ ...legacySummary, invitees: [] });
  expect(get).toHaveBeenLastCalledWith("/referrals/summary");
});

test("normalizes and strictly validates referral redemption codes", () => {
  expect(normalizeReferralCode(" 0123456789ab ")).toBe("0123456789AB");
  expect(referralCodeSchema.safeParse(normalizeReferralCode("0123456789ab")).success).toBe(true);
  expect(referralCodeSchema.safeParse("0123456789AG").success).toBe(false);
  expect(referralCodeSchema.safeParse("0123456789A").success).toBe(false);
  expect(() => referralRedeemRequestSchema.parse({ code: "0123456789AB", userKey: "forged" })).toThrow();
});

test("posts a normalized strict redemption payload and parses safe status", async () => {
  const result = { status: "applied" as const, attributed: true as const, referrerName: "Inviting Friend", signupRewardIssued: true as const, firstPaidRewardStatus: "pending" as const };
  post.mockResolvedValueOnce({ data: { success: true, data: result } });
  await expect(redeemReferralCode(" 0123456789ab ")).resolves.toEqual(result);
  expect(post).toHaveBeenLastCalledWith("/referrals/redeem", { code: "0123456789AB" });
  expect(() => referralRedeemResultSchema.parse({ ...result, referrerEmail: "private@example.com" })).toThrow();
  expect(() => referralRedeemResultSchema.parse({ ...result, firstPaidRewardStatus: "unknown" })).toThrow();
});

test("maps referral domain errors without displaying arbitrary server messages", () => {
  expect(referralRedemptionErrorMessage({ response: { data: { error: { code: "SELF_REFERRAL", message: "unsafe detail" } } } })).toBe("You cannot use your own referral code.");
  expect(referralRedemptionErrorMessage({ response: { data: { error: { code: "UNKNOWN", message: "unsafe detail" } } } })).toBe("The referral code could not be applied. Please try again.");
});
