import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [header, sheet, layout, hook, api, conversation, sharedButton, sharedBadge] = await Promise.all([
  read("../components/ProfileAvatarButton.tsx"),
  read("../components/SparksBalanceSheet.tsx"),
  read("../app/_layout.tsx"),
  read("../hooks/use-billing-summary.ts"),
  read("./api-client.ts"),
  read("./conversation-client.ts"),
  read("../../../../shared/packages/ui/components/button/button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/badge/badge.mobile.tsx"),
]);

test("orders the shared compact Sparks badge immediately before the profile control", () => {
  const badge = header.indexOf("<Badge");
  const profile = header.indexOf("<ProfileAvatarButton", badge);
  expect(badge).toBeGreaterThan(0);
  expect(profile).toBeGreaterThan(badge);
  expect(header.slice(badge, profile)).not.toContain("<Button");
  expect(header).toContain('size="xs"');
  expect(header).toContain('variant="ghost"');
  expect(header).toContain("formatWholeSparks(balance)");
  expect(header).toContain("Sparks balance:");
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

test("mounts exactly one informational Sparks sheet at the root", () => {
  expect(layout.match(/<SparksBalanceSheet isOffline=\{isOffline\} \/>/g)).toHaveLength(1);
  expect(layout.indexOf("<SparksBalanceSheet isOffline={isOffline} />")).toBeGreaterThan(layout.indexOf("<Stack"));
  expect(sheet.match(/<BottomSheet/g)).toHaveLength(1);
  expect(sheet).toContain("Purchases are not available in the app.");
  expect(sheet).toContain('https://vorinthex.com/pricing');
  expect(sheet).toContain('reason === "insufficient-balance"');
  expect(sheet).toContain("Current balance:");
  expect(sheet).toContain('AppState.addEventListener("change"');
  expect(sheet).toContain("previousOffline.current && !isOffline");
  expect(sheet).not.toMatch(/purchaseSparks|buySparks|checkout|paymentIntent/i);
});

test("keeps every sheet action on the shared medium Button convention", () => {
  expect(sheet).not.toContain("Pressable");
  expect(sheet.match(/<Button/g)).toHaveLength(2);
  expect(sheet.match(/size="md"/g)).toHaveLength(2);
});

test("routes Axios and Core SSE failures through the central observer", () => {
  expect(api).toContain("return rejectObservedDomainError(error)");
  expect(api).toContain("throw createObservedHttpError(request.status, request.responseText)");
  expect(api).toContain('isAuthenticatedBearerRejection(request.status, request.getResponseHeader("www-authenticate"), Boolean(session))');
  expect(api).toContain("tokenVault.clearIfCurrent(generation)");
  expect(conversation).toContain("throw observeDomainError(Object.assign(new Error(terminal.message), { code: terminal.code }))");
  expect(sheet).toContain("subscribeDomainErrors");
  expect(sheet).toContain("billingSummaryQueryKey(userKey)");
  expect(sheet).toContain('refetchType: "active"');
});
