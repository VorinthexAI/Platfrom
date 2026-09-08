import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [header, sheet, layout, hook, api, conversation, sharedButton, sharedBadge, dialog, sharedPackage] = await Promise.all([
  read("../components/ProfileAvatarButton.tsx"),
  read("../components/SparksBalanceSheet.tsx"),
  read("../app/_layout.tsx"),
  read("../hooks/use-billing-summary.ts"),
  read("./api-client.ts"),
  read("./conversation-client.ts"),
  read("../../../../shared/packages/ui/components/button/button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/badge/badge.mobile.tsx"),
  read("../../../../shared/packages/ui/components/dialog/dialog.mobile.tsx"),
  read("../../../../shared/package.json"),
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
  expect(sheet.match(/<Dialog/g)).toHaveLength(1);
  expect(sheet).toContain("No active plan");
  expect(sheet).toContain("Restore renewal");
  expect(sheet).toContain("Cancel renewal");
  expect(sheet).toContain("View offers");
  expect(sheet).toContain("You need more Sparks");
  expect(sheet).toContain("<NeuralBackdrop");
  expect(sheet).toContain("<ChromeIcon");
  expect(sheet).toContain('reason === "insufficient-balance"');
  expect(sheet).toContain("Current balance:");
  expect(sheet).toContain("formatWholeSparks(balance ?? 0)");
  expect(sheet).not.toContain('"--"');
  expect(sheet).toContain("Spending is paused until");
  expect(sheet).toContain('AppState.addEventListener("change"');
  expect(sheet).toContain("previousOffline.current && !isOffline");
  expect(sheet).not.toMatch(/purchaseSparks|buySparks|checkout|paymentIntent/i);
});

test("uses the shared responsive dialog with backdrop and header dismissal", () => {
  expect(sharedPackage).toContain('"./ui/dialog"');
  expect(dialog).toContain('height: availableHeight * 0.8');
  expect(dialog).toContain('width: width * 0.8');
  expect(dialog).toContain("StyleSheet.absoluteFill");
  expect(dialog).toContain('variant="secondary"><CloseIcon');
  expect(dialog).toContain("onRequestClose={close}");
  expect(dialog).toContain("accessibilityViewIsModal");
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
