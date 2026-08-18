import { isAxiosError } from "axios";
import { create } from "zustand";

import { getJson, onUnauthorized, patchJson, revokeRemoteSession } from "@/lib/api-client";
import { clearAuthContext, readAuthContext, writeAuthContext } from "@/lib/auth-context-vault";
import { hasCompleteAuthContext, normalizeAuthContext, type AuthUser } from "@/lib/auth-helpers";
import { tokenVault } from "@/lib/token-vault";
import { useOnboardingStore } from "@/state/onboarding";

let authOperation = 0;

export type AuthStatus = "bootstrapping" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  organization: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
  contentExecution: { agentKey: string } | null;
  bootstrap: () => Promise<void>;
  hydrate: () => Promise<void>;
  reconnectContentContext: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
};

async function loadContext() {
  return normalizeAuthContext(await getJson<unknown>("/auth/me"));
}

const signedOutState = {
  status: "unauthenticated" as const,
  user: null,
  organization: null,
  scope: null,
  contentExecution: null,
};

function isGuest(user: AuthUser | null) {
  return user?.email?.endsWith("@guest.vorinthex.com") ?? false;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  user: null,
  organization: null,
  scope: null,
  contentExecution: null,
  bootstrap: async () => {
    const operation = ++authOperation;
    const { session, generation } = await tokenVault.snapshot();
    if (!session) {
      await clearAuthContext();
      if (operation === authOperation) set(signedOutState);
      return;
    }
    try {
      const context = await loadContext();
      if (isGuest(context.user)) {
        const guestSession = await tokenVault.read();
        await Promise.all([tokenVault.clear(), clearAuthContext()]);
        if (operation === authOperation) set(signedOutState);
        if (guestSession) await revokeRemoteSession(guestSession).catch(() => undefined);
        return;
      }
      if (operation === authOperation) {
        await writeAuthContext(context);
        if (operation === authOperation) set({ status: "authenticated", ...context });
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401
        && String(error.response.headers["www-authenticate"] ?? "").includes("Bearer")) {
        const recoveryOperation = ++authOperation;
        await tokenVault.clearIfCurrent(generation);
        await clearAuthContext();
        if (recoveryOperation === authOperation) set(signedOutState);
        return;
      }
      const cached = await readAuthContext();
      if (cached && isGuest(cached.user)) {
        await Promise.all([tokenVault.clear(), clearAuthContext()]);
        if (operation === authOperation) set(signedOutState);
        return;
      }
      if (operation === authOperation) set(cached && hasCompleteAuthContext(cached)
        ? { status: "authenticated", ...cached }
        : signedOutState);
    }
  },
  hydrate: async () => {
    const operation = ++authOperation;
    const context = await loadContext();
    if (operation === authOperation) {
      await writeAuthContext(context);
      if (operation === authOperation) set({ status: "authenticated", ...context });
    }
  },
  reconnectContentContext: async () => {
    const operation = ++authOperation;
    const context = await loadContext();
    if (!hasCompleteAuthContext(context)) throw new Error("Archive execution context is unavailable.");
    if (operation === authOperation) {
      await writeAuthContext(context);
      if (operation === authOperation) set({ status: "authenticated", ...context });
    }
  },
  completeOnboarding: async () => {
    const operation = ++authOperation;
    const context = normalizeAuthContext(await patchJson<{ isOnboarded: true }, unknown>("/auth/me", { isOnboarded: true }));
    if (operation === authOperation) {
      await writeAuthContext(context);
      if (operation === authOperation) set({ status: "authenticated", ...context });
    }
  },
  signOut: async () => {
    authOperation += 1;
    useOnboardingStore.getState().reset();
    const session = await tokenVault.read();
    const clearing = Promise.all([tokenVault.clear(), clearAuthContext()]);
    set(signedOutState);
    await clearing;
    if (session) await revokeRemoteSession(session).catch(() => undefined);
  },
}));

onUnauthorized(() => {
  authOperation += 1;
  useOnboardingStore.getState().reset();
  void clearAuthContext();
  useAuthStore.setState(signedOutState);
});
