import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [paywall, sparkCosts, balance, layout, profile, bottomSheet] = await Promise.all([
  read("../components/PaywallSheet.tsx"),
  read("../components/SparkCostsSheet.tsx"),
  read("../components/SparksBalanceSheet.tsx"),
  read("../app/_layout.tsx"),
  read("../components/AccountScreen.tsx"),
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"),
]);

test("mounts one catalog-driven shared-control paywall with checkout and referral pages", () => {
  expect(layout.match(/<PaywallSheet \/>/g)).toHaveLength(1);
  expect(paywall).toContain("activeSubscriptionOffers(products)");
  expect(paywall).toContain('productId === "nova.monthly.discounted"');
  expect(paywall).toContain("discountedPriceCents");
  expect(paywall).not.toContain("POPULAR");
  expect(paywall).toContain('variant="primary">{checkoutState');
  expect(paywall).toContain("createCheckoutHandoff(selected.productId, Crypto.randomUUID())");
  expect(paywall).toContain("WebBrowser.openAuthSessionAsync(handoff.url, CHECKOUT_SUCCESS_URL)");
  expect(paywall).toContain("refreshAuthoritativeBilling(queryClient, userKey)");
  expect(paywall).toContain('setPage("referral")');
  expect(paywall).toContain("Invite a friend with your code");
  expect(paywall).toContain("Taxes are calculated at checkout.");
  expect(paywall).toContain("activeTopup(products)");
  expect(paywall).toContain('mode === "standard" && topup');
  expect(paywall).toContain("One-time top-up");
  expect(paywall).toContain("Continue to checkout");
  expect(paywall).toContain("One balance for everything you create and use");
  expect(paywall).toContain("Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex.");
  expect(paywall).not.toMatch(/Choose an offer\.|Choose your plan\.|Usage-based pricing|Pay only for what you use/i);
  expect(paywall).toContain('accessibilityLabel="How Sparks are billed"');
  expect(paywall).toContain("<SparkCostsSheet");
  expect(sparkCosts).toContain("charges.map((charge)");
  expect(sparkCosts).not.toContain("charges.filter(");
  expect(sparkCosts).toContain("Spark per new email");
  expect(sparkCosts).toContain("Sparks per GB-month");
  expect(sparkCosts).toContain('variant="secondary">Close</Button>');
  expect(sparkCosts).not.toContain("Sparks are the shared usage unit across Vorinthex");
  expect(sparkCosts).not.toMatch(/borderColor|borderWidth|borderRadius/);
  expect(paywall).not.toMatch(/Pressable|TouchableOpacity|<button/);
  expect(sparkCosts).not.toMatch(/Pressable|TouchableOpacity|<button/);
});

test("Sparks dialog reuses canonical billing and opens the offers shop", () => {
  expect(balance).toContain("useBillingSummary(userKey)");
  expect(balance).toContain("billingSummaryQueryKey(userKey)");
  expect(balance).toContain("No active plan");
  expect(balance).toContain('from "@vorinthex/shared/ui/dialog"');
  expect(balance).toContain("Restore renewal");
  expect(balance).toContain("Cancel renewal");
  expect(balance).toContain("setSubscriptionCancellation");
  expect(balance).toContain("View offers");
  expect(balance).not.toContain("activeTopup");
  expect(balance).not.toMatch(/Pressable|TouchableOpacity|Linking\.openURL/);
});

test("Profile routes to Settings while account actions remain available", () => {
  expect(profile).toContain('router.push("/settings")');
  expect(profile).toContain(">Notifications</Button>");
  expect(profile).toContain(">Give feedback</Button>");
  expect(profile).toContain(">Report an issue</Button>");
  expect(profile).toContain(">FAQ</Button>");
  expect(profile).toContain('accessibilityLabel="Log out"');
  expect(profile).not.toContain('focusKey="profile-settings"');
  for (const text of ["What are Sparks?", "How do plan grants work?", "Do top-ups expire?", "How do referral rewards work?", "Can I cancel or renew?", "How do I restore renewal?"]) expect(profile).toContain(text);
});

test("all ordinary paywall, balance, and profile sheet controls resolve to md", () => {
  expect(paywall).toContain('size="md" variant="primary">Share</Button>');
  expect(balance.match(/<Button/g)?.length).toBe(balance.match(/size="md"/g)?.length);
  expect(bottomSheet).toContain('export type BottomSheetItemProps = Omit<ButtonProps, "size">');
  expect(bottomSheet).toContain('size="md"');
});
