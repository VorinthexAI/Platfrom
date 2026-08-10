import { expect, mock, test } from "bun:test";

const guestContext = {
  user: { email: "guest.example@guest.vorinthex.com", is_onboarded: false },
  organization: { key: "org" },
  main_scope: { key: "scope" },
  content_execution: { agent_key: "agent" },
};
let unauthorizedListener: (() => void) | undefined;
let patchCalls = 0;
let tokenClears = 0;

mock.module("@/lib/api-client", () => ({
  getJson: async () => guestContext,
  onUnauthorized: (listener: () => void) => {
    unauthorizedListener = listener;
    return () => undefined;
  },
  patchJson: async () => {
    patchCalls += 1;
    if (patchCalls === 1) {
      unauthorizedListener?.();
      throw { isAxiosError: true, response: { status: 401 } };
    }
    return { ...guestContext, user: { ...guestContext.user, is_onboarded: true } };
  },
  postJson: async () => guestContext,
  revokeRemoteSession: async () => undefined,
}));
mock.module("@/lib/auth-context-vault", () => ({
  clearAuthContext: async () => undefined,
  readAuthContext: async () => null,
  writeAuthContext: async () => undefined,
}));
mock.module("@/lib/installation", () => ({
  getGuestBootstrapCredentials: async () => ({ distinctId: "app_test", bootstrapSecret: "guest_test" }),
  rotateGuestBootstrapCredentials: async () => undefined,
}));
mock.module("@/lib/token-vault", () => ({
  tokenVault: {
    clear: async () => { tokenClears += 1; },
    clearIfCurrent: async () => true,
    read: async () => null,
    snapshot: async () => ({ session: null, generation: 0 }),
  },
}));
mock.module("@/state/onboarding", () => ({
  useOnboardingStore: { getState: () => ({ reset: () => undefined }) },
}));

const { useAuthStore } = await import("../state/auth");

test("reconnects a guest session and retries onboarding after a 401", async () => {
  useAuthStore.setState({
    status: "authenticated",
    user: { email: "guest.example@guest.vorinthex.com", isOnboarded: false },
    organization: { key: "org" },
    scope: { key: "scope" },
    contentExecution: { agentKey: "agent" },
  });

  await useAuthStore.getState().completeOnboarding();

  expect(patchCalls).toBe(2);
  expect(tokenClears).toBe(1);
  expect(useAuthStore.getState().user?.isOnboarded).toBe(true);
});
