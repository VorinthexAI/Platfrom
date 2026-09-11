import { beforeEach, expect, mock, test } from "bun:test";

const realContext = {
  user: { key: "user", email: "user@example.com", country_code: "SE", is_onboarded: true },
  team: { key: "team" },
  teamMembership: { key: "membership", role: "owner" },
  teamSelectionEnabled: true,
  scope: { key: "scope" },
};
const guestContext = {
  ...realContext,
  user: { key: "guest", email: "guest.example@guest.vorinthex.com", is_onboarded: false },
};
const storedSession = {
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: Date.now() + 60_000,
  refreshExpiresAt: Date.now() + 120_000,
};

let contextResponse: unknown = realContext;
let patchResponse: unknown = realContext;
let patchError: Error | undefined;
let patchGate: Promise<void> | undefined;
let postGate: Promise<void> | undefined;
let postError: Error | undefined;
let session: typeof storedSession | null = null;
let getCalls = 0;
let clearContextCalls = 0;
let clearTokenCalls = 0;
let revokeCalls = 0;
let cleanupCalls = 0;
let cleanupError: Error | undefined;
let cleanupGate: Promise<void> | undefined;
let tokenReadError: Error | undefined;
let tokenReadGate: Promise<void> | undefined;
const patchCalls: unknown[] = [];
const postCalls: unknown[] = [];
const deleteCalls: unknown[] = [];
let clearOnboardingCalls = 0;
let writeContextCalls = 0;
let unauthorizedListener: (() => void) | undefined;

mock.module("@/lib/api-client", () => ({
  apiClient: {
    delete: async (...args: unknown[]) => { deleteCalls.push(args); },
    post: (...args: unknown[]) => {
      const handler = (globalThis as { __archiveApiPost?: (...input: unknown[]) => unknown }).__archiveApiPost;
      if (!handler) throw new Error("Archive API test handler is unavailable.");
      return handler(...args);
    },
  },
  getJson: async () => {
    getCalls += 1;
    if (contextResponse instanceof Error || (contextResponse as { isAxiosError?: boolean })?.isAxiosError) {
      const response = (contextResponse as { response?: { status?: number; headers?: Record<string, string> } }).response;
      if (response?.status === 401 && String(response.headers?.["www-authenticate"] ?? "").includes("Bearer")) unauthorizedListener?.();
      throw contextResponse;
    }
    return contextResponse;
  },
  onUnauthorized: (listener: () => void) => {
    unauthorizedListener = listener;
    return () => undefined;
  },
  patchJson: async (path: string, input: unknown) => { patchCalls.push({ path, input }); await patchGate; if (patchError) throw patchError; return patchResponse; },
  postJson: async (path: string, input: unknown) => { postCalls.push({ path, input }); await postGate; if (postError) throw postError; return { deleted: true }; },
  revokeRemoteSession: async () => { revokeCalls += 1; },
  cleanupRemoteSession: async () => { cleanupCalls += 1; await cleanupGate; if (cleanupError) throw cleanupError; },
  deleteRemoteAccount: async () => { postCalls.push({ path: "/auth/me/delete", input: { confirmation: "DELETE MY ACCOUNT" } }); await postGate; if (postError) throw postError; },
}));
mock.module("@/lib/auth-context-vault", () => ({
  clearAuthContext: async () => { clearContextCalls += 1; },
  readAuthContext: async () => null,
  writeAuthContext: async () => { writeContextCalls += 1; },
}));
mock.module("@/lib/token-vault", () => ({
  tokenVault: {
    clear: async () => { clearTokenCalls += 1; session = null; },
    clearIfCurrent: async () => { clearTokenCalls += 1; session = null; return true; },
    read: async () => { await tokenReadGate; if (tokenReadError) throw tokenReadError; return session; },
    snapshot: async () => ({ session, generation: 0 }),
  },
}));
mock.module("@/lib/onboarding-state", () => ({
  clearOnboardingCompletion: async () => { clearOnboardingCalls += 1; },
  markOnboardingComplete: async () => undefined,
  resetOnboardingSession: () => undefined,
}));
const { useAuthStore } = await import("../state/auth");

beforeEach(() => {
  contextResponse = realContext;
  patchResponse = realContext;
  patchError = undefined;
  patchGate = undefined;
  postGate = undefined;
  postError = undefined;
  session = null;
  getCalls = 0;
  clearContextCalls = 0;
  clearTokenCalls = 0;
  revokeCalls = 0;
  cleanupCalls = 0;
  cleanupError = undefined;
  cleanupGate = undefined;
  tokenReadError = undefined;
  tokenReadGate = undefined;
  patchCalls.length = 0;
  postCalls.length = 0;
  deleteCalls.length = 0;
  clearOnboardingCalls = 0;
  writeContextCalls = 0;
  useAuthStore.setState({ status: "bootstrapping", user: null, team: null, teamMembership: null, teamSelectionEnabled: false, scope: null });
});

test("optimistically completes onboarding before the profile request resolves", async () => {
  let releasePatch!: () => void;
  patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: false }, team: realContext.team, teamMembership: realContext.teamMembership, teamSelectionEnabled: true, scope: realContext.scope });

  const completion = useAuthStore.getState().completeOnboarding();

  expect(useAuthStore.getState().user?.isOnboarded).toBe(true);
  expect(patchCalls).toEqual([{ path: "/auth/me", input: { isOnboarded: true } }]);
  releasePatch();
  await completion;
  expect(useAuthStore.getState().user?.isOnboarded).toBe(true);
  expect(writeContextCalls).toBe(1);
});

test("rolls optimistic onboarding completion back when the profile request fails", async () => {
  patchError = new Error("profile unavailable");
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: false }, team: realContext.team, teamMembership: realContext.teamMembership, teamSelectionEnabled: true, scope: realContext.scope });

  const completion = useAuthStore.getState().completeOnboarding();
  expect(useAuthStore.getState().user?.isOnboarded).toBe(true);

  await expect(completion).rejects.toThrow("profile unavailable");
  expect(useAuthStore.getState().user?.isOnboarded).toBe(false);
  expect(clearOnboardingCalls).toBe(0);
});

test("preserves and reconciles an optimistic avatar while onboarding completion returns stale profile data", async () => {
  let releasePatch!: () => void;
  patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  patchResponse = { ...realContext, user: { ...realContext.user, is_onboarded: true, avatar_url: null } };
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: false }, team: realContext.team, teamMembership: realContext.teamMembership, teamSelectionEnabled: true, scope: realContext.scope });
  const avatar = useAuthStore.getState().optimisticProfile({ avatarUrl: "https://example.com/candidate.png" });

  const completion = useAuthStore.getState().completeOnboarding();
  expect(useAuthStore.getState().user?.avatarUrl).toBe("https://example.com/candidate.png");
  releasePatch();
  await completion;
  expect(useAuthStore.getState().user?.avatarUrl).toBe("https://example.com/candidate.png");

  avatar.reconcile({ avatarUrl: "https://example.com/profile.png" });
  expect(useAuthStore.getState().user?.avatarUrl).toBe("https://example.com/profile.png");
});

test("clears auth immediately while remote account deletion is pending", async () => {
  session = storedSession;
  useAuthStore.setState({ status: "authenticated", user: { key: "user", email: "user@example.com" }, team: { key: "team" }, scope: { key: "scope" } });
  let releasePost!: () => void;
  postGate = new Promise<void>((resolve) => { releasePost = resolve; });

  const completion = useAuthStore.getState().deleteAccount();

  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearContextCalls).toBe(1);
  expect(clearOnboardingCalls).toBe(1);
  await Promise.resolve();
  expect(postCalls).toEqual([{ path: "/auth/me/delete", input: { confirmation: "DELETE MY ACCOUNT" } }]);
  releasePost();
  await completion;
  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
  expect(clearOnboardingCalls).toBe(1);
});

test("keeps local auth cleared when remote account deletion fails", async () => {
  session = storedSession;
  useAuthStore.setState({ status: "authenticated", user: { key: "user", email: "user@example.com" }, team: { key: "team" }, scope: { key: "scope" } });
  postError = new Error("deletion unavailable");

  await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow("deletion unavailable");

  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
});

test("optimistically switches scope and can reconcile or roll back", () => {
  const originalScope = { key: "scope-old", name: "Main" };
  const nextScope = { key: "scope-next", slug: "work", name: "Work", summary: "Work workspace", description: null, position: 2, level: 1, role: "owner" as const, isCurrent: true };
  useAuthStore.setState({ status: "authenticated", user: { key: "user", email: "user@example.com" }, team: { key: "team" }, scope: originalScope });

  const first = useAuthStore.getState().optimisticScope(nextScope);
  expect(useAuthStore.getState().scope?.key).toBe("scope-next");
  expect(writeContextCalls).toBe(0);
  first.rollback();
  expect(useAuthStore.getState().scope).toEqual(originalScope);

  const second = useAuthStore.getState().optimisticScope(nextScope);
  second.reconcile({ ...nextScope, name: "Work Space" });
  expect(useAuthStore.getState().scope?.name).toBe("Work Space");
});

test("an older scope response cannot overwrite a newer optimistic selection", () => {
  const scope = (key: string) => ({ key, slug: key, name: key, summary: `${key} workspace`, description: null, position: 1, level: 1, role: "owner" as const, isCurrent: true });
  useAuthStore.setState({ status: "authenticated", user: { key: "user", email: "user@example.com" }, team: { key: "team" }, scope: scope("main") });

  const older = useAuthStore.getState().optimisticScope(scope("work"));
  const newer = useAuthStore.getState().optimisticScope(scope("personal"));
  older.rollback();
  older.reconcile(scope("work"));

  expect(useAuthStore.getState().scope?.key).toBe("personal");
  newer.reconcile(scope("personal"));
  expect(useAuthStore.getState().scope?.key).toBe("personal");
});

test("shows signed-out state without creating a guest when no session exists", async () => {
  await useAuthStore.getState().bootstrap();

  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(getCalls).toBe(0);
  expect(clearContextCalls).toBe(1);
});

test("hydrates a persisted real account session", async () => {
  session = storedSession;

  await useAuthStore.getState().bootstrap();

  expect(useAuthStore.getState().status).toBe("authenticated");
  expect(useAuthStore.getState().user?.email).toBe("user@example.com");
  expect(clearTokenCalls).toBe(0);
});

test("retires a persisted legacy guest session", async () => {
  session = storedSession;
  contextResponse = guestContext;

  await useAuthStore.getState().bootstrap();

  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
  expect(revokeCalls).toBe(1);
});

test("clears an expired server session without guest recovery", async () => {
  session = storedSession;
  contextResponse = { isAxiosError: true, response: { status: 401, headers: { "www-authenticate": "Bearer" } } };

  await useAuthStore.getState().bootstrap();

  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(clearTokenCalls).toBe(1);
  expect(revokeCalls).toBe(0);
});

test("does not clear a session for a non-bearer 401", async () => {
  session = storedSession;
  contextResponse = { isAxiosError: true, response: { status: 401, headers: {} } };

  await useAuthStore.getState().bootstrap();

  expect(clearTokenCalls).toBe(0);
  expect(session).toEqual(storedSession);
});

test("optimistically updates and rolls back profile fields without touching the session", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, team: realContext.team, scope: realContext.scope });
  const update = useAuthStore.getState().optimisticProfile({ avatarUrl: "file:///avatar.png" });

  expect(useAuthStore.getState().user?.avatarUrl).toBe("file:///avatar.png");
  update.rollback();
  expect(useAuthStore.getState().user?.avatarUrl).toBeUndefined();
  expect(session).toBeNull();
});

test("an older failed profile request cannot overwrite a newer optimistic edit", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, team: realContext.team, scope: realContext.scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });

  older.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Katherine");
  newer.reconcile({ name: "Katherine Johnson" });
  expect(useAuthStore.getState().user?.name).toBe("Katherine Johnson");
});

test("two failed optimistic edits restore the last confirmed value", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, team: realContext.team, scope: realContext.scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });
  older.rollback();
  newer.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Ada");
});

test("a newer failure restores an older successful edit", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, team: realContext.team, scope: realContext.scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });
  older.reconcile({ name: "Grace Hopper" });
  newer.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Grace Hopper");
});

test("signs out locally even when secure session reads fail", async () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true }, team: realContext.team, scope: realContext.scope });
  tokenReadError = new Error("secure storage unavailable");
  await useAuthStore.getState().signOut();
  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
  expect(cleanupCalls).toBe(0);
});

test("signs out synchronously before secure storage and remote revocation finish", async () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true }, team: realContext.team, scope: realContext.scope });
  session = storedSession;
  let releaseRead!: () => void;
  tokenReadGate = new Promise<void>((resolve) => { releaseRead = resolve; });

  const completion = useAuthStore.getState().signOut();
  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(0);
  expect(clearContextCalls).toBe(0);
  expect(cleanupCalls).toBe(0);

  releaseRead();
  await completion;
  expect(clearTokenCalls).toBe(1);
  expect(cleanupCalls).toBe(1);
});

test("awaits failed remote cleanup while still completing local cleanup", async () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true }, team: realContext.team, scope: realContext.scope });
  session = storedSession;
  cleanupError = new Error("offline");
  let releaseCleanup!: () => void;
  cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });

  let completed = false;
  const completion = useAuthStore.getState().signOut().then(() => { completed = true; });
  await Bun.sleep(10);
  expect(cleanupCalls).toBe(1);
  expect(completed).toBe(false);
  releaseCleanup();
  await completion;
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
  expect(useAuthStore.getState().status).toBe("unauthenticated");
});

test("remote cleanup checks responses and bounds offline waits", async () => {
  const source = await Bun.file(new URL("./api-client.ts", import.meta.url)).text();
  expect(source).toContain("if (!response.ok) throw new Error");
  expect(source).toContain("controller.abort(), 2_000");
  expect(source).toContain('request("/auth/me/push-subscription", { method: "DELETE", body: "{}" })');
  expect(source).toContain('request("/auth/logout", { method: "POST", body: "{}" })');
  expect(source.indexOf('request("/auth/me/push-subscription"')).toBeLessThan(source.indexOf('request("/auth/logout"'));
  expect(source).toContain("failure ??= error");
});
