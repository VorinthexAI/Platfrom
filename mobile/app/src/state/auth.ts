import { isAxiosError } from "axios";
import { create } from "zustand";

import { cleanupRemoteSession, deleteRemoteAccount, fetchReferralSummary, getJson, onUnauthorized, patchJson, revokeRemoteSession } from "@/lib/auth-transport";
import { clearAuthContext, readAuthContext, writeAuthContext } from "@/lib/auth-context-vault";
import { hasCompleteAuthContext, normalizeAuthContext, type AuthUser } from "@/lib/auth-helpers";
import { emptyWorkspacePicker, type WorkspacePickerState } from "@/data/registry";
import { clearPendingReferralCode } from "@/lib/pending-referral-vault";
import { tokenVault } from "@/lib/token-vault";
import { markOnboardingComplete, markOnboardingPreviewComplete, markPostDeletionOnboarding, resetOnboardingSession } from "@/lib/onboarding-state";
import { endSessionRequests, resumeSessionRequests, sessionEpoch, sessionIsEnding } from "@/lib/session-lifecycle";
import type { ReferralSummary } from "@/lib/referral-client";
import type { ScopeSummary } from "@/lib/scope-client";

let authOperation = 0;
let deletion: Promise<void> | undefined;
let hydration: { epoch: number; promise: Promise<void> } | undefined;
let scopeMutation = 0;
let confirmedScope: Record<string, unknown> | null = null;

export type AuthStatus = "bootstrapping" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  team: Record<string, unknown> | null;
  teamMembership: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
  rootTeamMember: boolean;
  workspacePicker: WorkspacePickerState;
  referralSummary: ReferralSummary | null;
  bootstrap: () => Promise<void>;
  hydrate: (options?: { newSession?: boolean }) => Promise<void>;
  reconnectContentContext: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  optimisticScope: (scope: ScopeSummary) => OptimisticScopeUpdate;
  optimisticProfile: (patch: ProfilePatch) => OptimisticProfileUpdate;
  applyWorkspacePicker: (picker: WorkspacePickerState) => void;
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

function queueProfileContextWrite(state: Pick<AuthState, "team" | "teamMembership" | "scope" | "status" | "user" | "rootTeamMember" | "workspacePicker">, operation: number) {
  if (state.status !== "authenticated" || !state.user) return Promise.resolve();
  const context = { user: state.user, team: state.team, teamMembership: state.teamMembership, scope: confirmedScope ?? state.scope, rootTeamMember: state.rootTeamMember, workspacePicker: state.workspacePicker };
  profileVaultWrites = profileVaultWrites.then(async () => {
    if (operation === authOperation) await writeAuthContext(context);
  }).catch(() => undefined);
  return profileVaultWrites;
}

async function loadContext() {
  return normalizeAuthContext(await getJson<unknown>("/auth/me"));
}

async function loadReferralSummary(user: AuthUser | null, existing: ReferralSummary | null) {
  if (!user?.key) return null;
  if (existing?.code.ownerUserKey === user.key) return existing;
  return fetchReferralSummary().catch(() => null);
}

const signedOutState = {
  status: "unauthenticated" as const,
  user: null,
  team: null,
  teamMembership: null,
  scope: null,
  rootTeamMember: false,
  workspacePicker: emptyWorkspacePicker,
  referralSummary: null,
};

function isGuest(user: AuthUser | null) {
  return user?.email?.endsWith("@guest.vorinthex.com") ?? false;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "bootstrapping",
  user: null,
  team: null,
  teamMembership: null,
  scope: null,
  rootTeamMember: false,
  workspacePicker: emptyWorkspacePicker,
  referralSummary: null,
  bootstrap: async () => {
    if (sessionIsEnding()) return;
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
      const referralSummary = await loadReferralSummary(context.user, get().referralSummary);
      if (operation === authOperation) {
        confirmedScope = context.scope;
        set({ status: "authenticated", ...context, referralSummary });
        void markOnboardingPreviewComplete().catch(() => undefined);
        if (context.user?.isOnboarded) void markOnboardingComplete().catch(() => undefined);
        await writeAuthContext(context);
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
        set(cached && hasCompleteAuthContext(cached) ? { status: "authenticated", ...cached, referralSummary: get().referralSummary?.code.ownerUserKey === cached.user?.key ? get().referralSummary : null } : signedOutState);
      }
    }
  },
  hydrate: (options) => {
    if (hydration?.epoch === sessionEpoch() && !sessionIsEnding()) return hydration.promise;
    if (options?.newSession) resumeSessionRequests();
    else if (get().status !== "authenticated" || sessionIsEnding()) return Promise.resolve();
    const operation = ++authOperation;
    const promise = (async () => {
      const context = await loadContext();
      const referralSummary = await loadReferralSummary(context.user, get().referralSummary);
      if (operation === authOperation) {
        confirmedScope = context.scope;
        set({ status: "authenticated", ...context, referralSummary });
        void markOnboardingPreviewComplete().catch(() => undefined);
        if (context.user?.isOnboarded) void markOnboardingComplete().catch(() => undefined);
        await writeAuthContext(context);
      }
    })().finally(() => { if (hydration?.promise === promise) hydration = undefined; });
    hydration = { epoch: sessionEpoch(), promise };
    return promise;
  },
  reconnectContentContext: async () => {
    if (get().status !== "authenticated" || sessionIsEnding()) return;
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
    const operation = authOperation;
    const previousUser = get().user;
    if (!previousUser) throw new Error("Onboarding completion requires an authenticated user.");
    set({ user: { ...previousUser, isOnboarded: true } });
    try {
      const context = normalizeAuthContext(await patchJson<{ isOnboarded: true }, unknown>("/auth/me", { isOnboarded: true }));
      if (operation === authOperation) {
        confirmedScope = context.scope;
        set((state) => ({
          status: "authenticated",
          ...context,
          user: state.user && context.user ? { ...context.user, name: state.user.name, avatarUrl: state.user.avatarUrl } : context.user,
        }));
        await Promise.all([queueProfileContextWrite(get(), operation), markOnboardingComplete().catch(() => undefined)]);
      }
    } catch (error) {
      if (operation === authOperation) {
        set((state) => ({ user: state.user ? { ...state.user, isOnboarded: previousUser.isOnboarded } : previousUser }));
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
  applyWorkspacePicker: (picker) => {
    set({ workspacePicker: picker });
    queueProfileContextWrite(get(), authOperation);
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
  deleteAccount: () => {
    if (deletion) return deletion;
    const previous = get();
    if (previous.status !== "authenticated") return Promise.reject(new Error("Please sign in again before deleting your account."));
    const operation = ++authOperation;
    endSessionRequests();
    set(signedOutState);
    deletion = (async () => {
      try {
        const { session } = await tokenVault.snapshot();
        if (!session) throw new Error("Please sign in again before deleting your account.");
        await deleteRemoteAccount(session);
        if (operation !== authOperation) return;
        confirmedScope = null;
        await Promise.allSettled([tokenVault.clear(), clearAuthContext(), clearPendingReferralCode(), markPostDeletionOnboarding()]);
      } catch {
        if (operation === authOperation) {
          set(previous);
          resumeSessionRequests();
        }
        throw new Error("Your account could not be deleted. Please try again.");
      }
    })().finally(() => { deletion = undefined; });
    return deletion;
  },
  signOut: async () => {
    const snapshot = tokenVault.read().catch(() => null);
    endSessionRequests();
    const localCleanup = Promise.allSettled([tokenVault.clear(), clearAuthContext()]);
    authOperation += 1;
    confirmedScope = null;
    resetOnboardingSession();
    void markOnboardingPreviewComplete().catch(() => undefined);
    set(signedOutState);
    const session = await snapshot;
    await Promise.allSettled([
      localCleanup,
      ...(session ? [cleanupRemoteSession(session)] : []),
    ]);
  },
}));

onUnauthorized(() => {
  if (sessionIsEnding()) return;
  endSessionRequests();
  authOperation += 1;
  confirmedScope = null;
  resetOnboardingSession();
  void clearAuthContext();
  useAuthStore.setState(signedOutState);
});
