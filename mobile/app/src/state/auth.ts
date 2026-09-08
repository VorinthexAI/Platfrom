import { isAxiosError } from "axios";
import { create } from "zustand";

import { cleanupRemoteSession, getJson, onUnauthorized, patchJson, postJson, revokeRemoteSession } from "@/lib/api-client";
import { clearAuthContext, readAuthContext, writeAuthContext } from "@/lib/auth-context-vault";
import { hasCompleteAuthContext, normalizeAuthContext, type AuthUser } from "@/lib/auth-helpers";
import { tokenVault } from "@/lib/token-vault";
import { clearOnboardingCompletion, markOnboardingComplete, resetOnboardingSession } from "@/lib/onboarding-state";
import type { ScopeSummary } from "@/lib/scope-client";

let authOperation = 0;
let scopeMutation = 0;
let confirmedScope: Record<string, unknown> | null = null;

export type AuthStatus = "bootstrapping" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  team: Record<string, unknown> | null;
  teamMembership: Record<string, unknown> | null;
  teamSelectionEnabled: boolean;
  scope: Record<string, unknown> | null;
  bootstrap: () => Promise<void>;
  hydrate: () => Promise<void>;
  reconnectContentContext: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  optimisticScope: (scope: ScopeSummary) => OptimisticScopeUpdate;
  optimisticProfile: (patch: ProfilePatch) => OptimisticProfileUpdate;
  deleteAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

export type ProfilePatch = Pick<AuthUser, "avatarUrl" | "name">;
export type OptimisticProfileUpdate = {
  reconcile: (patch?: ProfilePatch) => void;
  rollback: () => void;
};
export type OptimisticScopeUpdate = {
  reconcile: (scope: ScopeSummary) => void;
  rollback: () => void;
};

const profileVersions = { avatarUrl: 0, name: 0 };
type ProfileField = keyof ProfilePatch;
type ProfileMutation = { status: "failed" | "pending" | "succeeded"; value: string | undefined };
type ProfileMutationState = { authOperation: number; baseline: string | undefined; mutations: Map<number, ProfileMutation> };
const profileMutations: Partial<Record<ProfileField, ProfileMutationState>> = {};
let profileVaultWrites = Promise.resolve();

function profileKeys(patch: ProfilePatch) {
  return Object.keys(patch) as (keyof ProfilePatch)[];
}

function queueProfileContextWrite(state: Pick<AuthState, "team" | "teamMembership" | "teamSelectionEnabled" | "scope" | "status" | "user">, operation: number) {
  if (state.status !== "authenticated" || !state.user) return;
  const context = { user: state.user, team: state.team, teamMembership: state.teamMembership, teamSelectionEnabled: state.teamSelectionEnabled, scope: confirmedScope ?? state.scope };
  profileVaultWrites = profileVaultWrites.then(async () => {
    if (operation === authOperation) await writeAuthContext(context);
  }).catch(() => undefined);
}

async function loadContext() {
  return normalizeAuthContext(await getJson<unknown>("/auth/me"));
}

const signedOutState = {
  status: "unauthenticated" as const,
  user: null,
  team: null,
  teamMembership: null,
  teamSelectionEnabled: false,
  scope: null,
};

function isGuest(user: AuthUser | null) {
  return user?.email?.endsWith("@guest.vorinthex.com") ?? false;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "bootstrapping",
  user: null,
  team: null,
  teamMembership: null,
  teamSelectionEnabled: false,
  scope: null,
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
        confirmedScope = context.scope;
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
      if (operation === authOperation) {
        confirmedScope = cached && hasCompleteAuthContext(cached) ? cached.scope : null;
        set(cached && hasCompleteAuthContext(cached) ? { status: "authenticated", ...cached } : signedOutState);
      }
    }
  },
  hydrate: async () => {
    const operation = ++authOperation;
    const context = await loadContext();
    if (operation === authOperation) {
      confirmedScope = context.scope;
      await writeAuthContext(context);
      if (operation === authOperation) set({ status: "authenticated", ...context });
    }
  },
  reconnectContentContext: async () => {
    const operation = ++authOperation;
    const context = await loadContext();
    if (!hasCompleteAuthContext(context)) throw new Error("Archive execution context is unavailable.");
    if (operation === authOperation) {
      confirmedScope = context.scope;
      await writeAuthContext(context);
      if (operation === authOperation) set({ status: "authenticated", ...context });
    }
  },
  completeOnboarding: async () => {
    const operation = ++authOperation;
    const previousUser = get().user;
    if (!previousUser) throw new Error("Onboarding completion requires an authenticated user.");
    set({ user: { ...previousUser, isOnboarded: true } });
    try {
      const context = normalizeAuthContext(await patchJson<{ isOnboarded: true }, unknown>("/auth/me", { isOnboarded: true }));
      if (operation === authOperation) {
        confirmedScope = context.scope;
        await Promise.all([writeAuthContext(context), markOnboardingComplete().catch(() => undefined)]);
        if (operation === authOperation) set({ status: "authenticated", ...context });
      }
    } catch (error) {
      if (operation === authOperation) {
        set({ user: previousUser });
      }
      throw error;
    }
  },
  optimisticScope: (scope) => {
    const operation = authOperation;
    const mutation = ++scopeMutation;
    const previous = get().scope;
    const apply = (next: Record<string, unknown> | null, persist: boolean) => {
      const current = get();
      if (operation !== authOperation || mutation !== scopeMutation || current.status !== "authenticated") return;
      set({ scope: next });
      if (persist) {
        confirmedScope = next;
        queueProfileContextWrite(get(), operation);
      }
    };
    apply(scope, false);
    return {
      reconcile: (selected) => apply(selected, true),
      rollback: () => apply(previous, false),
    };
  },
  optimisticProfile: (patch) => {
    const keys = profileKeys(patch);
    const versions = Object.fromEntries(keys.map((key) => [key, ++profileVersions[key]])) as Record<keyof ProfilePatch, number>;
    const operation = authOperation;
    for (const key of keys) {
      let state = profileMutations[key];
      if (!state || state.authOperation !== operation) {
        state = { authOperation: operation, baseline: get().user?.[key], mutations: new Map() };
        profileMutations[key] = state;
      }
      state.mutations.set(versions[key], { status: "pending", value: patch[key] });
    }
    const apply = (next: ProfilePatch) => {
      const current = get();
      if (operation !== authOperation || !current.user) return;
      set({ user: { ...current.user, ...next } });
      queueProfileContextWrite(get(), operation);
    };
    apply(patch);
    const settle = (status: "failed" | "succeeded", serverPatch: ProfilePatch) => {
      const next: ProfilePatch = {};
      for (const key of keys) {
        const state = profileMutations[key];
        const mutation = state?.authOperation === operation ? state.mutations.get(versions[key]) : undefined;
        if (!state || !mutation) continue;
        mutation.status = status;
        if (status === "succeeded" && Object.hasOwn(serverPatch, key)) mutation.value = serverPatch[key];
        const winner = [...state.mutations.entries()]
          .filter(([, candidate]) => candidate.status !== "failed")
          .sort(([left], [right]) => right - left)[0]?.[1];
        next[key] = winner?.value ?? state.baseline;
        if (![...state.mutations.values()].some((candidate) => candidate.status === "pending")) delete profileMutations[key];
      }
      if (Object.keys(next).length) apply(next);
    };
    return {
      reconcile: (serverPatch = patch) => settle("succeeded", serverPatch),
      rollback: () => settle("failed", {}),
    };
  },
  deleteAccount: async () => {
    await postJson<{ confirmation: "DELETE MY ACCOUNT" }, { deleted: true }>("/auth/me/delete", { confirmation: "DELETE MY ACCOUNT" });
    authOperation += 1;
    confirmedScope = null;
    set(signedOutState);
    await Promise.allSettled([tokenVault.clear(), clearAuthContext(), clearOnboardingCompletion()]);
  },
  signOut: async () => {
    authOperation += 1;
    confirmedScope = null;
    resetOnboardingSession();
    set(signedOutState);
    const session = await tokenVault.read().catch(() => null);
    await Promise.allSettled([
      tokenVault.clear(),
      clearAuthContext(),
      ...(session ? [cleanupRemoteSession(session)] : []),
    ]);
  },
}));

onUnauthorized(() => {
  authOperation += 1;
  confirmedScope = null;
  resetOnboardingSession();
  void clearAuthContext();
  useAuthStore.setState(signedOutState);
});
