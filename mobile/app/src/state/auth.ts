import { isAxiosError } from "axios";
import { create } from "zustand";

import { getJson, onUnauthorized, revokeRemoteSession } from "@/lib/api-client";
import { normalizeAuthContext, type AuthUser } from "@/lib/auth-helpers";
import { tokenVault } from "@/lib/token-vault";

let authOperation = 0;

export type AuthStatus = "bootstrapping" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  organization: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
  bootstrap: () => Promise<void>;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
};

async function loadContext() {
  return normalizeAuthContext(await getJson<unknown>("/auth/me"));
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  user: null,
  organization: null,
  scope: null,
  bootstrap: async () => {
    const operation = ++authOperation;
    const { session, generation } = await tokenVault.snapshot();
    if (!session) {
      if (operation === authOperation) set({ status: "unauthenticated", user: null, organization: null, scope: null });
      return;
    }
    try {
      const context = await loadContext();
      if (operation === authOperation) set({ status: "authenticated", ...context });
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        if (operation === authOperation) {
          await tokenVault.clearIfCurrent(generation);
          set({ status: "unauthenticated", user: null, organization: null, scope: null });
        }
        return;
      }
      // An existing offline session remains protected and can recover on the next request.
      if (operation === authOperation) set({ status: "authenticated" });
    }
  },
  hydrate: async () => {
    const operation = ++authOperation;
    const context = await loadContext();
    if (operation === authOperation) set({ status: "authenticated", ...context });
  },
  signOut: async () => {
    authOperation += 1;
    const session = await tokenVault.read();
    const clearing = tokenVault.clear();
    set({ status: "unauthenticated", user: null, organization: null, scope: null });
    await clearing;
    if (session) await revokeRemoteSession(session).catch(() => undefined);
  },
}));

onUnauthorized(() => {
  authOperation += 1;
  useAuthStore.setState({ status: "unauthenticated", user: null, organization: null, scope: null });
});
