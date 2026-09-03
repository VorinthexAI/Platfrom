import { beforeEach, expect, mock, test } from "bun:test";

const realContext = {
  user: { key: "user", email: "user@example.com", country_code: "SE", is_onboarded: true },
  organization: { key: "org" },
  main_scope: { key: "scope" },
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
let session: typeof storedSession | null = null;
let getCalls = 0;
let clearContextCalls = 0;
let clearTokenCalls = 0;
let revokeCalls = 0;
let tokenReadError: Error | undefined;
let tokenReadGate: Promise<void> | undefined;
const patchCalls: unknown[] = [];
let unauthorizedListener: (() => void) | undefined;

mock.module("@/lib/api-client", () => ({
  apiClient: {
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
  patchJson: async (path: string, input: unknown) => { patchCalls.push({ path, input }); return realContext; },
  revokeRemoteSession: async () => { revokeCalls += 1; },
}));
mock.module("@/lib/auth-context-vault", () => ({
  clearAuthContext: async () => { clearContextCalls += 1; },
  readAuthContext: async () => null,
  writeAuthContext: async () => undefined,
}));
mock.module("@/lib/token-vault", () => ({
  tokenVault: {
    clear: async () => { clearTokenCalls += 1; session = null; },
    clearIfCurrent: async () => { clearTokenCalls += 1; session = null; return true; },
    read: async () => { await tokenReadGate; if (tokenReadError) throw tokenReadError; return session; },
    snapshot: async () => ({ session, generation: 0 }),
  },
}));
mock.module("@/state/onboarding", () => ({
  useOnboardingStore: { getState: () => ({ reset: () => undefined }) },
}));

const { useAuthStore } = await import("../state/auth");

beforeEach(() => {
  contextResponse = realContext;
  session = null;
  getCalls = 0;
  clearContextCalls = 0;
  clearTokenCalls = 0;
  revokeCalls = 0;
  tokenReadError = undefined;
  tokenReadGate = undefined;
  patchCalls.length = 0;
  useAuthStore.setState({ status: "bootstrapping", user: null, organization: null, scope: null });
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
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, organization: realContext.organization, scope: realContext.main_scope });
  const update = useAuthStore.getState().optimisticProfile({ avatarUrl: "file:///avatar.png" });

  expect(useAuthStore.getState().user?.avatarUrl).toBe("file:///avatar.png");
  update.rollback();
  expect(useAuthStore.getState().user?.avatarUrl).toBeUndefined();
  expect(session).toBeNull();
});

test("an older failed profile request cannot overwrite a newer optimistic edit", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, organization: realContext.organization, scope: realContext.main_scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });

  older.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Katherine");
  newer.reconcile({ name: "Katherine Johnson" });
  expect(useAuthStore.getState().user?.name).toBe("Katherine Johnson");
});

test("two failed optimistic edits restore the last confirmed value", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, organization: realContext.organization, scope: realContext.main_scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });
  older.rollback();
  newer.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Ada");
});

test("a newer failure restores an older successful edit", () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true, name: "Ada" }, organization: realContext.organization, scope: realContext.main_scope });
  const older = useAuthStore.getState().optimisticProfile({ name: "Grace" });
  const newer = useAuthStore.getState().optimisticProfile({ name: "Katherine" });
  older.reconcile({ name: "Grace Hopper" });
  newer.rollback();
  expect(useAuthStore.getState().user?.name).toBe("Grace Hopper");
});

test("signs out locally even when secure session reads fail", async () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true }, organization: realContext.organization, scope: realContext.main_scope });
  tokenReadError = new Error("secure storage unavailable");
  await useAuthStore.getState().signOut();
  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(1);
  expect(clearContextCalls).toBe(1);
});

test("signs out synchronously before secure storage and remote revocation finish", async () => {
  useAuthStore.setState({ status: "authenticated", user: { ...realContext.user, isOnboarded: true }, organization: realContext.organization, scope: realContext.main_scope });
  session = storedSession;
  let releaseRead!: () => void;
  tokenReadGate = new Promise<void>((resolve) => { releaseRead = resolve; });

  const completion = useAuthStore.getState().signOut();
  expect(useAuthStore.getState().status).toBe("unauthenticated");
  expect(useAuthStore.getState().user).toBeNull();
  expect(clearTokenCalls).toBe(0);
  expect(revokeCalls).toBe(0);

  releaseRead();
  await completion;
  expect(clearTokenCalls).toBe(1);
  expect(revokeCalls).toBe(1);
});
