import * as SecureStore from "expo-secure-store";

import { referralCodeSchema } from "./referral-client";

const PENDING_REFERRAL_CODE_KEY = "vorinthex.auth.referral-code.v1";

export async function savePendingReferralCode(value: unknown) {
  const parsed = referralCodeSchema.safeParse(value);
  if (!parsed.success) return false;
  await SecureStore.setItemAsync(PENDING_REFERRAL_CODE_KEY, parsed.data, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return true;
}

export async function readPendingReferralCode() {
  const value = await SecureStore.getItemAsync(PENDING_REFERRAL_CODE_KEY);
  const parsed = referralCodeSchema.safeParse(value);
  if (!parsed.success) {
    if (value !== null) await SecureStore.deleteItemAsync(PENDING_REFERRAL_CODE_KEY);
    return undefined;
  }
  return parsed.data;
}

export function clearPendingReferralCode() {
  return SecureStore.deleteItemAsync(PENDING_REFERRAL_CODE_KEY);
}
