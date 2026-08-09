import { isAxiosError } from "axios";
import { create } from "zustand";

import { getJson, onUnauthorized, patchJson, postJson, revokeRemoteSession } from "@/lib/api-client";
import { clearAuthContext, readAuthContext, writeAuthContext } from "@/lib/auth-context-vault";
import { normalizeAuthContext, type AuthUser } from "@/lib/auth-helpers";
import { getGuestBootstrapCredentials } from "@/lib/installation";
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
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
};

async function loadContext() {
  return normalizeAuthContext(await getJson<unknown>("/auth/me"));
}

async function bootstrapGuest() {
  return normalizeAuthContext(await postJson<{ distinctId: string; bootstrapSecret: string }, unknown>(
    "/auth/guest",
    await getGuestBootstrapCredentials(),
  ));
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
      try {
        const context = await bootstrapGuest();
        if (operation === authOperation) {
          await writeAuthContext(context);
          if (operation === authOperation) set({ status: "authenticated", ...context });
        }
      } catch {
        if (operation === authOperation) set({ status: "unauthenticated", user: null, organization: null, scope: null, contentExecution: null });
      }
      return;
    }
    try {
      const context = await loadContext();
      if (operation === authOperation) {
        await writeAuthContext(context);
        if (operation === authOperation) set({ status: "authenticated", ...context });
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        const recoveryOperation = ++authOperation;
        await tokenVault.clearIfCurrent(generation);
        await clearAuthContext();
        try {
          const context = await bootstrapGuest();
          if (recoveryOperation === authOperation) {
            await writeAuthContext(context);
            if (recoveryOperation === authOperation) set({ status: "authenticated", ...context });
          }
        } catch {
          if (recoveryOperation === authOperation) set({ status: "unauthenticated", user: null, organization: null, scope: null, contentExecution: null });
        }
        return;
      }
      const cached = await readAuthContext();
      if (operation === authOperation) set(cached
        ? { status: "authenticated", ...cached }
        : { status: "unauthenticated", user: null, organization: null, scope: null, contentExecution: null });
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
    set({ status: "unauthenticated", user: null, organization: null, scope: null, contentExecution: null });
    await clearing;
    if (session) await revokeRemoteSession(session).catch(() => undefined);
  },
}));

onUnauthorized(() => {
  authOperation += 1;
  useOnboardingStore.getState().reset();
  void clearAuthContext();
  useAuthStore.setState({ status: "unauthenticated", user: null, organization: null, scope: null, contentExecution: null });
});
