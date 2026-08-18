import * as SecureStore from "expo-secure-store";

const PENDING_RETURN_ROUTE_KEY = "vorinthex.auth.return-route.v1";
const SHARE_RETURN_ROUTE = /^\/share\/[A-Za-z0-9_-]{32,512}$/;

export function validPendingReturnRoute(value: unknown): value is string {
  return typeof value === "string" && SHARE_RETURN_ROUTE.test(value);
}

export async function savePendingReturnRoute(value: string) {
  if (!validPendingReturnRoute(value)) return false;
  await SecureStore.setItemAsync(PENDING_RETURN_ROUTE_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return true;
}

export async function readPendingReturnRoute() {
  const value = await SecureStore.getItemAsync(PENDING_RETURN_ROUTE_KEY);
  return validPendingReturnRoute(value) ? value : undefined;
}

export function clearPendingReturnRoute() {
  return SecureStore.deleteItemAsync(PENDING_RETURN_ROUTE_KEY);
}
