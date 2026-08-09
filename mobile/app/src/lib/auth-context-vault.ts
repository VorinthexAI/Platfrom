import * as SecureStore from "expo-secure-store";
import { normalizeAuthContext, type AuthContext } from "./auth-helpers";

const AUTH_CONTEXT_KEY = "vorinthex.auth.context.v1";

export async function readAuthContext(): Promise<AuthContext | null> {
  const raw = await SecureStore.getItemAsync(AUTH_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const context = normalizeAuthContext(JSON.parse(raw));
    return context.user ? context : null;
  } catch {
    await SecureStore.deleteItemAsync(AUTH_CONTEXT_KEY);
    return null;
  }
}

export function writeAuthContext(context: AuthContext) {
  return SecureStore.setItemAsync(AUTH_CONTEXT_KEY, JSON.stringify(context), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function clearAuthContext() {
  return SecureStore.deleteItemAsync(AUTH_CONTEXT_KEY);
}
