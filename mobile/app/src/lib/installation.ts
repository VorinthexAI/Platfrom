import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DISTINCT_ID_KEY = "vorinthex.installation.distinct-id.v1";
const DISTINCT_ID_PATTERN = /^app_[A-Za-z0-9_-]{16,76}$/;
let pendingDistinctId: Promise<string> | undefined;

export function createDistinctId() {
  return `app_${randomUUID()}`;
}

export function getDistinctId() {
  if (pendingDistinctId) return pendingDistinctId;
  const attempt = (async () => {
    const existing = await SecureStore.getItemAsync(DISTINCT_ID_KEY);
    if (existing && DISTINCT_ID_PATTERN.test(existing)) return existing;
    const distinctId = createDistinctId();
    await SecureStore.setItemAsync(DISTINCT_ID_KEY, distinctId, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return distinctId;
  })();
  pendingDistinctId = attempt.catch((error) => {
    pendingDistinctId = undefined;
    throw error;
  });
  return pendingDistinctId;
}
