import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [header, observer, paywall, layout, hook, api, conversation, sharedButton, sharedBadge] = await Promise.all([
  read("../components/ProfileAvatarButton.tsx"),
  read("../components/SparksBalanceObserver.tsx"),
  read("../components/PaywallSheet.tsx"),
  read("../app/_layout.tsx"),
  read("../hooks/use-billing-summary.ts"),
  read("./api-client.ts"),
  read("./conversation-client.ts"),
  read("../../../../shared/packages/ui/components/button/button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/badge/badge.mobile.tsx"),
]);

test("orders the shared compact secondary Sparks button immediately before the profile control", () => {
  const headerRight = header.indexOf("export function ProfileHeaderRight");
  const sparks = header.indexOf("<SparksBalanceButton", headerRight);
  const profile = header.indexOf("<ProfileAvatarButton", sparks);
  const balanceButton = header.slice(header.indexOf("export function SparksBalanceButton"), headerRight);
  expect(sparks).toBeGreaterThan(headerRight);
  expect(profile).toBeGreaterThan(sparks);
  expect(balanceButton).toContain('size="xs"');
  expect(balanceButton).toContain('variant="secondary"');
  expect(header).toContain("formatWholeSparks(balance ?? 0)");
  expect(header).not.toContain('"--"');
  expect(header).toContain("Sparks balance:");
  expect(balanceButton).toContain("openPaywall");
  expect(balanceButton).not.toContain("openSparksSheet");
  expect(header).toContain("hitSlop={8}");
  expect(header).not.toContain("Pressable");
});

test("uses shared Button and Badge contracts without changing shared UI", () => {
  expect(header).toContain('from "@vorinthex/shared/ui/button"');
  expect(header).toContain('from "@vorinthex/shared/ui/badge"');
  expect(sharedButton).toContain('export function Button(');
  expect(sharedBadge).toContain('export function Badge(');
});

test("selects only floored whole Sparks on a user-scoped query", () => {
  expect(hook).toContain('billingSummaryQueryKey(userKey ?? "unauthenticated")');
  expect(hook).toContain("select: (summary) => wholeSparks(summary.microSparkBalance)");
  expect(hook).toContain("enabled: Boolean(userKey)");
  expect(hook).toContain("refetchInterval: BILLING_BALANCE_POLL_INTERVAL_MS");
  expect(hook).toContain("refetchIntervalInBackground: false");
  expect(hook).toContain('refetchOnReconnect: "always"');
});

test("mounts one nonvisual balance observer and routes every entry to Sparks", () => {
  expect(layout.match(/<SparksBalanceObserver isOffline=\{isOffline\} \/>/g)).toHaveLength(1);
  expect(layout.indexOf("<SparksBalanceObserver isOffline={isOffline} />")).toBeGreaterThan(layout.indexOf("<Stack"));
  expect(observer).toContain("subscribeDomainErrors");
  expect(observer).toContain("openPaywall()");
  expect(observer).toContain("billingSummaryQueryKey(userKey)");
  expect(observer).toContain('refetchType: "active"');
  expect(observer).toContain('state === "active"');
  expect(observer).toContain("previousOffline.current && !isOffline");
  expect(observer).toContain("return null");
  expect(observer).not.toMatch(/Dialog|BottomSheet|openSparksSheet/);
  expect(paywall).toContain('title={page === "plans" ? "Sparks"');
  expect(paywall).toContain("Current balance");
  expect(paywall).toContain("formatWholeSparks(balance ?? 0)");
  expect(paywall).toContain('accessibilityLabel="How Sparks are billed"');
});

test("routes Axios and Core SSE failures through the central observer", () => {
  expect(api).toContain("return rejectObservedDomainError(error)");
  expect(api).toContain("throw createObservedHttpError(request.status, request.responseText)");
  expect(api).toContain('isAuthenticatedBearerRejection(request.status, request.getResponseHeader("www-authenticate"), Boolean(session))');
  expect(api).toContain("tokenVault.clearIfCurrent(generation)");
  expect(conversation).toContain("throw observeDomainError(Object.assign(new Error(terminal.message), { code: terminal.code }))");
  expect(observer).toContain("subscribeDomainErrors");
  expect(observer).toContain("billingSummaryQueryKey(userKey)");
  expect(observer).toContain('refetchType: "active"');
});
