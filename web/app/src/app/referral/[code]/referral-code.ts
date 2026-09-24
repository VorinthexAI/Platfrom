const REFERRAL_CODE_PATTERN = /^[0-9A-F]{12}$/;

export function isValidReferralCode(code: string) {
  return REFERRAL_CODE_PATTERN.test(code);
}
