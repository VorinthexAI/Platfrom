import { beforeEach, expect, mock, test } from "bun:test";

const realContext = {
  user: { key: "user", email: "user@example.com", country_code: "SE", is_onboarded: true },
  organization: { key: "org" },
  main_scope: { key: "scope" },
  content_execution: { agent_key: "agent" },
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
    read: async () => session,
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
  patchCalls.length = 0;
  useAuthStore.setState({ status: "bootstrapping", user: null, organization: null, scope: null, contentExecution: null });
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
